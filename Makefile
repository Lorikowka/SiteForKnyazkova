.SILENT:
.PHONY: up down build logs restart clean

up:
	docker-compose up -d
	echo [OK] Project started

down:
	docker-compose down
	echo [OK] Project stopped

build:
	docker-compose up -d --build
	echo [OK] Containers rebuilt and started

logs:
	docker-compose logs -f

restart:
	docker-compose restart
	echo [OK] Project restarted

clean:
	docker-compose down -v
	docker system prune -f
	echo [OK] Everything is clean