.PHONY: help install check test build start build-start stop deploy stop-server test-e2e test-manual

DEV_COMPOSE := docker compose -p night-of-witnesses-dev -f compose.dev.yml

help:
	@echo "make start        Build and start local Docker Dev at localhost:3000"
	@echo "make build-start  Alias for make start"
	@echo "make stop         Stop Dev and remove its containers and image"
	@echo "make build        Build the Docker Dev image (includes dependencies)"
	@echo "make install      Alias for make build"
	@echo "make check        Check TypeScript types inside Docker"
	@echo "make test         Run unit and integration tests inside Docker"
	@echo "make test-e2e     Install Chromium and run browser tests inside Docker"
	@echo "make test-manual  Start Docker Dev for manual browser testing"
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

test-e2e: build
	$(DEV_COMPOSE) run --rm --no-deps --user root dev sh -c "npm exec -- playwright install --with-deps chromium && npm run test:e2e"

test-manual: start
	@echo "Open http://localhost:3000 in three browser windows for manual testing."
