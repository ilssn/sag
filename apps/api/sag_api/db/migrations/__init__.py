"""Alembic 迁移树（ADR-0014）。

迁移脚本随包分发（PyInstaller 冻结后仍可用）；运行时不读 alembic.ini，
由 sag_api.db.migrate 以本包路径程序化构建配置。
"""
