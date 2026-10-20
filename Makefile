.PHONY: help install check test test-api migrate seed build start build-start stop deploy stop-server test-e2e test-manual bots

DEV_COMPOSE := docker compose -p night-of-witnesses-dev -f compose.dev.yml

help:
	@echo "make start        Build and start local Docker Dev at localhost:3000"
	@echo "make build-start  Alias for make start"
	@echo "make stop         Stop Dev and remove its containers and image"
	@echo "make build        Build the Docker Dev image (includes dependencies)"
	@echo "make install      Alias for make build"
	@echo "make check        Check TypeScript types inside Docker"
	@echo "make test         Run unit and integration tests inside Docker"
	@echo "make test-api     Run FastAPI/PostgreSQL tests against isolated test storage"
	@echo "make migrate      Apply pending development database migrations"
	@echo "make seed         Create initial admin from SEED_ADMIN_PASSWORD in .env"
	@echo "make test-e2e     Install Chromium and run browser tests inside Docker"
	@echo "make test-manual  Start Docker Dev for manual browser testing"
	@echo "make bots ROOM=ABC123  Add 3 bots to an existing development room"
	@echo "make deploy       Run scripts/docker-boot.sh (macOS/Colima)"
	@echo "make stop-server  Run scripts/docker-boot.sh --stop"

install: build

check: build
	$(DEV_COMPOSE) run --rm --no-deps dev npm run check

test: build
	$(DEV_COMPOSE) run --rm --no-deps dev npm test

build:
	$(DEV_COMPOSE) build

start:
	$(DEV_COMPOSE) up -d --build --wait

build-start: start

stop:
	$(DEV_COMPOSE) down --rmi all

deploy:
	./scripts/docker-boot.sh

stop-server:
	./scripts/docker-boot.sh --stop

test-e2e: start
	$(DEV_COMPOSE) --profile test build browser-test
	$(DEV_COMPOSE) up -d --no-deps --force-recreate --wait api
	$(DEV_COMPOSE) --profile test run --rm browser-test npm run test:e2e -- --project=chromium
	$(DEV_COMPOSE) up -d --no-deps --force-recreate --wait api
	$(DEV_COMPOSE) --profile test run --rm browser-test npm run test:e2e -- --project=mobile-chromium

test-api:
	$(DEV_COMPOSE) --profile test run --build --rm api-test

migrate:
	$(DEV_COMPOSE) run --build --rm migrate

seed: migrate
	$(DEV_COMPOSE) --profile tools run --rm seed

bots:
	$(if $(strip $(ROOM)),,$(error Usage: make bots ROOM=ABC123))
	$(DEV_COMPOSE) exec dev npm run add-bots -- "$(ROOM)"

test-manual: start
	@echo "Open http://localhost:3000 in three browser windows for manual testing."
