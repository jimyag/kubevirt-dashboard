package helm

import (
	"path/filepath"
	"testing"

	"helm.sh/helm/v3/pkg/helmpath"
	"helm.sh/helm/v3/pkg/repo"
)

func TestDNSLabel(t *testing.T) {
	for _, value := range []string{"a", "prometheus-community", "0"} {
		if !isDNSLabel(value) {
			t.Errorf("isDNSLabel(%q) = false, want true", value)
		}
	}
	for _, value := range []string{"", "-a", "a-", "a.b", "UPPER", string(make([]byte, 64))} {
		if isDNSLabel(value) {
			t.Errorf("isDNSLabel(%q) = true, want false", value)
		}
	}
}

func TestSettingsAreIsolatedByRESTHost(t *testing.T) {
	root := t.TempDir()
	first, err := newSettingsForRoot(root, "https://cluster-a.example")
	if err != nil {
		t.Fatal(err)
	}
	second, err := newSettingsForRoot(root, "https://cluster-b.example")
	if err != nil {
		t.Fatal(err)
	}
	if first.RepositoryConfig == second.RepositoryConfig {
		t.Fatal("different REST hosts share a repository config")
	}
	if filepath.Dir(first.RepositoryConfig) == root {
		t.Fatal("repository config is not in a cluster-specific directory")
	}
}

func TestRepositoryNamesCannotEscapeCache(t *testing.T) {
	if isDNSLabel("../outside") || isDNSLabel("a/b") {
		t.Fatal("a path-like repository name was accepted")
	}
}

func TestCachedHTTPRepositoryDoesNotFetchIndex(t *testing.T) {
	settings, err := newSettingsForRoot(t.TempDir(), "https://cluster.example")
	if err != nil {
		t.Fatal(err)
	}
	entry := &repo.Entry{Name: "charts", URL: "http://127.0.0.1:1"}
	index := repo.NewIndexFile()
	path := filepath.Join(settings.RepositoryCache, helmpath.CacheIndexFile(entry.Name))
	if err := index.WriteFile(path, 0o600); err != nil {
		t.Fatal(err)
	}
	loaded, err := cachedHTTPRepository(settings, entry)
	if err != nil {
		t.Fatalf("cached repository was fetched again: %v", err)
	}
	if loaded.APIVersion != repo.APIVersionV1 {
		t.Fatalf("unexpected index API version %q", loaded.APIVersion)
	}
}

func TestMissingRepositoryFileIsEmpty(t *testing.T) {
	settings, err := newSettingsForRoot(t.TempDir(), "https://cluster.example")
	if err != nil {
		t.Fatal(err)
	}
	file, err := readRepositories(settings)
	if err != nil {
		t.Fatal(err)
	}
	if len(file.Repositories) != 0 {
		t.Fatalf("missing repository file returned %d entries", len(file.Repositories))
	}
}
