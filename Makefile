ifeq ($(wildcard /run/.containerenv),)
CRE ?= podman
else
CRE ?= podman-remote
endif
-include local.mk
IMAGE ?= skills-mcp:local
QUADLET_USER_DIR ?= $(HOME)/.config/containers/systemd
OPENCODE_CONFIG ?= $(HOME)/.config/opencode/opencode.jsonc
MCP_URL ?= http://127.0.0.1:8080/mcp

.PHONY: build test smoke run-http install-user

build:
	@mkdir -p .build; CTX=$$(mktemp -d .build/ctx-XXXXXX); \
	scripts/render.sh skills $$CTX/skills && \
	mkdir -p $$CTX/server && cp server/server.mjs $$CTX/server/server.mjs && \
	$(CRE) build -f containerfile -t $(IMAGE) $$CTX

test:
	node --test "server/test/**/*.test.mjs" "scripts/test/**/*.test.mjs"
	sh scripts/test-no-sensitive.sh
	sh scripts/test-render.sh

smoke: build
	@OUT=$$(printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | $(CRE) run --rm -i $(IMAGE)); \
	echo "$$OUT" | grep -q '"name":"skills"' && \
	echo "$$OUT" | grep -q 'list_skills' && \
	echo "$$OUT" | grep -q 'mellanox_flash_ops_docs' && \
	echo "$$OUT" | grep -q 'unix_process_ops_docs' && echo smoke-ok

run-http: build
	$(CRE) run --rm -p 8080:8080 -e MCP_MODE=http $(IMAGE)

install-user: build
	install -D -m 0644 deploy/skills-mcp.container $(QUADLET_USER_DIR)/skills-mcp.container
	systemctl --user daemon-reload
	systemctl --user restart skills-mcp.service
	node scripts/patch-mcp-config.mjs set $(OPENCODE_CONFIG) skills '{"type":"remote","url":"$(MCP_URL)"}'
