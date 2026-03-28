.PHONY: dev dev-d build stop logs migrate migrate-create test shell-backend shell-frontend install clean

dev:
	docker compose up

dev-d:
	docker compose up -d

build:
	docker compose build

stop:
	docker compose down

logs:
	docker compose logs -f

migrate:
	docker compose exec backend uv run alembic upgrade head

migrate-create:
	docker compose exec backend uv run alembic revision --autogenerate -m "$(name)"

test:
	docker compose exec backend uv run pytest

shell-backend:
	docker compose exec backend bash

shell-frontend:
	docker compose exec frontend sh

install:
	docker compose build --no-cache

clean:
	docker compose down -v --remove-orphans
