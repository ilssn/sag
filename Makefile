.DEFAULT_GOAL := help
.PHONY: help dev api web install install-api install-web test build compose-config compose-up compose-down

help: ## 显示可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: install-api install-web ## 安装前后端依赖

install-api: ## 安装后端依赖（editable + dev）
	cd apps/api && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"

install-web: ## 安装前端依赖
	cd apps/web && npm install

dev: ## 提示：分别在两个终端运行 make api / make web
	@echo "在一个终端运行:  make api"
	@echo "在另一个终端运行: make web"

api: ## 启动后端（本地零依赖 SQLite+LanceDB，热重载，局域网可访问）
	cd apps/api && . .venv/bin/activate && uvicorn sag_api.main:app --reload --host 0.0.0.0 --port 8000

web: ## 启动前端（Next dev，局域网可访问）
	cd apps/web && npm run dev -- -H 0.0.0.0

test: ## 运行后端与 Agent Core 测试
	cd apps/api && . .venv/bin/activate && pytest -q

build: ## 构建前端产物
	cd apps/web && npm run build

compose-config: ## 校验 docker compose 配置
	cd deploy && docker compose config

compose-up: ## 生产：docker compose 启动（web+api+postgres）
	cd deploy && docker compose up -d --build

compose-down: ## 停止 compose
	cd deploy && docker compose down
