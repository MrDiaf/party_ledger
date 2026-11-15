# Party Ledger — D&D group organiser. Run `make help`.
COMPOSE := docker compose
-include .env
APP_PORT ?= 8590
ADMIN_PORT ?= 8591
PHB_PDF ?= ./PHB-5e.pdf
SHEET_PDF ?= ./DnD_2024_Character-Sheet.pdf
# Optional: the Monster Manual (2024) PDF feeds the DM's monster catalog. Without it, /dev/null is mounted
# instead and the catalog is empty (custom monsters still work).
MM_PDF ?= ./D&D 5e - Monster Manual 2024.pdf
ifneq ($(shell test -f "$(MM_PDF)" && echo yes),yes)
override MM_PDF := /dev/null
endif
export MM_PDF
# Funnel only allows public ports 443, 8443 and 10000 (443 and 8443 are already used on this host).
FUNNEL_PORT ?= 10000

.DEFAULT_GOAL := help
.PHONY: help up down restart logs status build test ai-login funnel-up funnel-down funnel-status clean-data check-docker check-tailscale

help: ## Show this help
	@echo "Available commands:"
	@echo
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-12s %s\n", $$1, $$2}'

check-docker:
	@command -v docker >/dev/null 2>&1 || { echo "Docker is required to run this project. Install Docker and retry."; exit 1; }
	@docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 (docker compose) is required. Install it and retry."; exit 1; }
	@test -f "$(PHB_PDF)" || { echo "PHB PDF not found at $(PHB_PDF). Put it there or set PHB_PDF in .env."; exit 1; }
	@test -f "$(SHEET_PDF)" || { echo "Character sheet PDF not found at $(SHEET_PDF). Put it there or set SHEET_PDF in .env."; exit 1; }
	@test "$(MM_PDF)" != /dev/null || echo "Note: no Monster Manual PDF found (MM_PDF), so the DM monster catalog will be empty."

up: check-docker ## Build (if needed) and start the app
	@$(COMPOSE) up -d --build
	@printf "Waiting for the app to become healthy"; \
	for i in $$(seq 1 60); do \
	  s=$$(docker inspect -f '{{.State.Health.Status}}' $$($(COMPOSE) ps -q app) 2>/dev/null); \
	  if [ "$$s" = healthy ]; then echo; break; fi; printf "."; sleep 1; \
	  if [ $$i = 60 ]; then echo; echo "App did not become healthy. See: make logs"; exit 1; fi; \
	done
	@echo
	@echo "Party Ledger is running."
	@echo
	@echo "  App:    http://localhost:$(APP_PORT)          (LAN; point Tailscale serve/funnel here)"
	@echo "  Admin:  http://localhost:$(ADMIN_PORT)/admin    (home network only)"
	@echo
	@echo "Run 'make help' for more commands."

down: ## Stop the app (keeps all data)
	@$(COMPOSE) down

restart: ## Restart the app
	@$(COMPOSE) restart

logs: ## Follow app logs
	@$(COMPOSE) logs -f --tail=100

status: ## Show running services
	@$(COMPOSE) ps

build: check-docker ## Rebuild the image without starting
	@$(COMPOSE) build

test: check-docker ## Run server + rules tests in a container
	@docker build -q --target build -t dnd-table:test ./app >/dev/null
	@docker run --rm dnd-table:test npm test

ai-login: ## Link the ChatGPT subscription from a terminal (alternative to Admin → AI)
	@$(COMPOSE) exec app codex login --device-auth

check-tailscale:
	@command -v tailscale >/dev/null 2>&1 || { echo "Tailscale is required for this command. Install it and retry."; exit 1; }

funnel-up: check-tailscale ## Share the main app on the internet via Tailscale Funnel (never the admin port)
	@tailscale funnel --bg --https=$(FUNNEL_PORT) http://127.0.0.1:$(APP_PORT) || { echo "If this was a permission error, run once: sudo tailscale set --operator=$$USER"; exit 1; }
	@host=$$(tailscale status --json | grep -m1 -o '"DNSName": *"[^"]*"' | cut -d'"' -f4); host=$${host%.}; \
	echo; \
	echo "Party Ledger is on the internet:"; \
	echo; \
	echo "  https://$$host:$(FUNNEL_PORT)"; \
	echo; \
	echo "Share that link with your friends. Stop sharing with: make funnel-down"; \
	echo "Tip: once your friends have accounts, turn off registration in Admin -> Settings."

funnel-down: check-tailscale ## Stop sharing the app via Funnel (your other funnels are left alone)
	@tailscale funnel --https=$(FUNNEL_PORT) off || { echo "If this was a permission error, run once: sudo tailscale set --operator=$$USER"; exit 1; }
	@echo "Funnel on port $(FUNNEL_PORT) is off."

funnel-status: check-tailscale ## Show the app's funnel link and everything Tailscale exposes
	@host=$$(tailscale status --json | grep -m1 -o '"DNSName": *"[^"]*"' | cut -d'"' -f4); host=$${host%.}; \
	if tailscale funnel status | grep -q ":$(FUNNEL_PORT)"; then echo "Party Ledger link: https://$$host:$(FUNNEL_PORT)"; \
	else echo "Party Ledger is not on Funnel (run: make funnel-up)"; fi; echo
	@tailscale funnel status

clean-data: ## DESTRUCTIVE: stop and delete ALL data (accounts, characters, logs)
	@read -p "This deletes every account, character and log. Type 'delete' to continue: " a; [ "$$a" = delete ] || { echo "Aborted."; exit 1; }
	@$(COMPOSE) down -v
