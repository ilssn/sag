"""R3 稳定硬化：就绪/存活探针、上传白名单、Job 退避重试、引擎 LRU 逐出。"""

import asyncio

import httpx
import pytest


async def _register(c, email="hard@t.com"):
    r = await c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_health_ready_and_upload_whitelist():
    from sag_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            assert (await c.get("/api/v1/system/health")).json()["status"] == "ok"
            ready = await c.get("/api/v1/system/ready")
            assert ready.status_code == 200 and ready.json()["db"] is True

            caps = (await c.get("/api/v1/system/capabilities")).json()
            assert ".md" in caps["allowed_upload_exts"]

            A = await _register(c)
            sid = (await c.post("/api/v1/sources", headers=A, json={"name": "白名单"})).json()["id"]

            # 不支持的扩展名 → 422（校验失败），前端展示明确提示
            bad = await c.post(
                f"/api/v1/sources/{sid}/documents",
                headers=A,
                files={"file": ("evil.exe", b"MZ", "application/octet-stream")},
            )
            assert bad.status_code == 422
            assert "不支持" in bad.json()["error"]["message"]

            # 允许的扩展名 → 201
            ok = await c.post(
                f"/api/v1/sources/{sid}/documents",
                headers=A,
                files={"file": ("note.md", b"# hi", "text/markdown")},
            )
            assert ok.status_code == 201


@pytest.mark.asyncio
async def test_job_retry_backoff(monkeypatch):
    """可重试失败退避重排至成功；不可重试失败立即 FAILED。"""
    from sqlalchemy import delete

    from sag_api.core.db import SessionLocal, init_db
    from sag_api.core.errors import ServiceUnavailableError, ValidationError
    from sag_api.db.models import Job
    from sag_api.enums import JobStatus, JobType
    from sag_api.jobs import inproc
    from sag_api.jobs.tasks import TASK_HANDLERS

    monkeypatch.setattr(inproc, "_BACKOFF_BASE_SECONDS", 0.01)
    await init_db()
    # 清除其他用例残留的 Job，避免 _recover 用我们的桩处理器跑它们污染计数
    async with SessionLocal() as s:
        await s.execute(delete(Job))
        await s.commit()

    calls = {"n": 0}

    async def flaky_handler(session, job, **_):
        calls["n"] += 1
        if calls["n"] < 3:
            raise ServiceUnavailableError("上游暂时不可用")

    monkeypatch.setitem(TASK_HANDLERS, JobType.PROCESS_DOCUMENT, flaky_handler)

    queue = inproc.InProcessAsyncQueue(SessionLocal, engine_manager=None, concurrency=1)
    await queue.start()
    try:
        async with SessionLocal() as s:
            job = Job(type=JobType.PROCESS_DOCUMENT, status=JobStatus.QUEUED)
            s.add(job)
            await s.commit()
            jid = job.id
        await queue.enqueue(jid)

        # 轮询至终态
        for _ in range(200):
            await asyncio.sleep(0.05)
            async with SessionLocal() as s:
                st = (await s.get(Job, jid)).status
            if st in (JobStatus.SUCCEEDED, JobStatus.FAILED):
                break
        async with SessionLocal() as s:
            done = await s.get(Job, jid)
        assert done.status == JobStatus.SUCCEEDED
        assert done.attempts == 3  # 两次失败 + 一次成功
        assert calls["n"] == 3

        # 不可重试：一次即失败
        calls["n"] = 0

        async def bad_handler(session, job, **_):
            calls["n"] += 1
            raise ValidationError("坏输入")

        monkeypatch.setitem(TASK_HANDLERS, JobType.PROCESS_DOCUMENT, bad_handler)
        async with SessionLocal() as s:
            job2 = Job(type=JobType.PROCESS_DOCUMENT, status=JobStatus.QUEUED)
            s.add(job2)
            await s.commit()
            jid2 = job2.id
        await queue.enqueue(jid2)
        for _ in range(100):
            await asyncio.sleep(0.05)
            async with SessionLocal() as s:
                st = (await s.get(Job, jid2)).status
            if st in (JobStatus.SUCCEEDED, JobStatus.FAILED):
                break
        async with SessionLocal() as s:
            done2 = await s.get(Job, jid2)
        assert done2.status == JobStatus.FAILED
        assert done2.attempts == 1 and calls["n"] == 1
    finally:
        await queue.stop()


@pytest.mark.asyncio
async def test_engine_lru_eviction():
    """超出缓存上限逐出最久未用；持锁的槽不被逐出。"""
    from sag_api.core.config import settings
    from sag_api.sag.engine_manager import EngineManager, _Slot

    class FakeEngine:
        def __init__(self):
            self.closed = False

        async def aclose(self):
            self.closed = True

    mgr = EngineManager(settings)
    mgr._cache_size = 3
    engines = {}
    for i in range(3):
        eng = FakeEngine()
        engines[f"s{i}"] = eng
        mgr._slots[f"s{i}"] = _Slot(engine=eng, last_used=float(i))

    # s0 最久未用，但先把它锁住 → 应跳过它，逐出次久的 s1
    await mgr._slots["s0"].lock.acquire()
    try:
        newest = FakeEngine()
        mgr._slots["s_new"] = _Slot(engine=newest, last_used=100.0)  # 现在 4 个 > 3
        await mgr._evict_lru(keep="s_new")
    finally:
        mgr._slots["s0"].lock.release()

    assert "s1" not in mgr._slots and engines["s1"].closed is True
    assert "s0" in mgr._slots  # 持锁被跳过
    assert "s_new" in mgr._slots and "s2" in mgr._slots


@pytest.mark.asyncio
async def test_engine_close_all_waits_for_inflight_use():
    """运行期保存配置不能关闭正在 ingest/search 的引擎。"""
    from sag_api.core.config import settings
    from sag_api.sag.engine_manager import EngineManager, _Slot

    class FakeEngine:
        closed = False

        async def aclose(self):
            self.closed = True

    engine = FakeEngine()
    manager = EngineManager(settings)
    manager._slots["source"] = _Slot(engine=engine)
    entered = asyncio.Event()
    release = asyncio.Event()

    async def in_flight():
        async with manager.use("source"):
            entered.set()
            await release.wait()

    use_task = asyncio.create_task(in_flight())
    await entered.wait()
    close_task = asyncio.create_task(manager.aclose_all())
    await asyncio.sleep(0)
    assert engine.closed is False
    release.set()
    await use_task
    await close_task
    assert engine.closed is True


@pytest.mark.asyncio
async def test_engine_lifecycle_reset_waits_for_inflight_operations():
    """新引擎重置共享资源前，必须等待已有引擎操作退出。"""
    from sag_api.sag.engine_manager import _EngineLifecycleGate

    gate = _EngineLifecycleGate()
    reader_entered = asyncio.Event()
    release_reader = asyncio.Event()
    writer_entered = asyncio.Event()

    async def hold_operation():
        async with gate.read():
            reader_entered.set()
            await release_reader.wait()

    async def reset_runtime():
        async with gate.write():
            writer_entered.set()

    reader = asyncio.create_task(hold_operation())
    await reader_entered.wait()
    writer = asyncio.create_task(reset_runtime())
    await asyncio.sleep(0.02)
    assert writer_entered.is_set() is False

    release_reader.set()
    await asyncio.gather(reader, writer)
    assert writer_entered.is_set() is True


@pytest.mark.asyncio
async def test_engine_allows_same_source_document_concurrency():
    """文档处理不再占用每源串行锁，同一信源可同时处理多篇文档。"""
    from sag_api.core.config import settings
    from sag_api.sag.engine_manager import EngineManager, _Slot

    class FakeEngine:
        async def aclose(self):
            pass

    manager = EngineManager(settings)
    manager._slots["source"] = _Slot(engine=FakeEngine())
    entered = 0
    both_entered = asyncio.Event()
    release = asyncio.Event()

    async def in_flight():
        nonlocal entered
        async with manager.use_concurrently("source"):
            entered += 1
            if entered == 2:
                both_entered.set()
            await release.wait()

    first = asyncio.create_task(in_flight())
    second = asyncio.create_task(in_flight())
    await asyncio.wait_for(both_entered.wait(), timeout=1)
    assert manager._slots["source"].concurrent_users == 2
    release.set()
    await asyncio.gather(first, second)
    assert manager._slots["source"].concurrent_users == 0


@pytest.mark.asyncio
async def test_search_falls_back_to_vector():
    """multi 失败或空结果时自动回退 vector；vector 自身失败不再回退。"""
    from sag_api.core.config import settings
    from sag_api.sag.engine_manager import EngineManager, _Slot

    class FakeEngine:
        def __init__(self, fail_multi: bool, empty_multi: bool = False):
            self.fail_multi = fail_multi
            self.empty_multi = empty_multi
            self.calls: list[str] = []

        async def search(self, query, strategy=None, top_k=None):
            self.calls.append(strategy)
            if strategy == "multi":
                if self.fail_multi:
                    raise RuntimeError("boom")
                if self.empty_multi:
                    return type("R", (), {"query": query, "sections": [], "stats": {}})()
            return type(
                "R",
                (),
                {
                    "query": query,
                    "sections": [
                        {"chunk_id": "c1", "source_id": "s", "source_config_id": "scid",
                         "heading": "h", "content": "x", "rank": 1, "score": 0.9, "weight": 1}
                    ],
                    "stats": {},
                },
            )()

        async def aclose(self):
            pass

    async def run_case(engine):
        em = EngineManager(settings)
        em._slots["scid"] = _Slot(engine=engine)
        return await em.search("scid", "q", strategy="multi")

    # 失败回退
    eng = FakeEngine(fail_multi=True)
    out = await run_case(eng)
    assert eng.calls == ["multi", "vector"] and len(out.sections) == 1
    # 空结果回退
    eng2 = FakeEngine(fail_multi=False, empty_multi=True)
    out2 = await run_case(eng2)
    assert eng2.calls == ["multi", "vector"] and len(out2.sections) == 1
    # vector 直查失败不回退
    class FailVector(FakeEngine):
        async def search(self, query, strategy=None, top_k=None):
            self.calls.append(strategy)
            raise RuntimeError("vector down")

    em = EngineManager(settings)
    fv = FailVector(fail_multi=False)
    em._slots["scid"] = _Slot(engine=fv)
    with pytest.raises(RuntimeError, match="vector down"):
        await em.search("scid", "q", strategy="vector")
    assert fv.calls == ["vector"]
