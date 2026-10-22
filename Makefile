.PHONY: build-ui build-go build clean image

BINARY_NAME=kubevirt-dashboard
IMAGE=ghcr.io/jimyag/kubevirt-dashboard
GIT_TAG?=$(shell git describe --tags --always)
BUILD_TIME?=$(shell date "+%Y-%m-%dT%H:%M:%S%z")
LDFLAGS=-s -w -X github.com/jimmicro/version.GitTag=$(GIT_TAG) -X github.com/jimmicro/version.BuildTime=$(BUILD_TIME)

build: build-ui build-go

build-ui:
	cd ui && bun install --frozen-lockfile && bun run build

build-go:
	go build -ldflags "$(LDFLAGS)" -o $(BINARY_NAME) .

image: build
	docker build -t $(IMAGE):latest .

clean:
	rm -f $(BINARY_NAME)
	rm -rf ui/dist
