.PHONY: help install check test build start build-start stop test-e2e test-manual

help:
	@echo "make install      Install dependencies (npm ci)"
	@echo "make check        Check TypeScript types"
	@echo "make test         Run unit and integration tests"
	@echo "make build        Build Docker Compose images"
	@echo "make start        Start game, Caddy and coturn (requires TURN settings)"
	@echo "make build-start  Build and start all Docker Compose services"
	@echo "make stop         Remove service containers, preserving volumes"
	@echo "make test-e2e     Run browser tests"
	@echo "make test-manual  Open the manual test"

install:
	npm ci

check:
	npm run check

test:
	npm test

build:
	docker compose --profile voice build

start:
	docker compose --profile voice up -d --wait

build-start:
	docker compose --profile voice up -d --build --wait

stop:
	docker compose --profile voice down

test-e2e:
	npm run test:e2e

test-manual:
	npm run test:manual
