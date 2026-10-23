---
name: adding-crd-resource-management
description: Use when adding Kubernetes built-in resources or extension CRDs to this dashboard, especially when every served stable, beta, and alpha API version must be discovered and wired without omissions.
---

# Adding CRD Resource Management

Use this workflow before adding a new resource family, provider, or CRD category to kubevirt-dashboard.

## Rules

- Do not rely on memory for API groups, resource names, scopes, or versions.
- Treat every installed served version as valid: stable, beta, and alpha versions must all be represented in discovery or fallback paths.
- Prefer the cluster's current served/preferred version as the primary path, then add older/newer served versions as alternates.
- If the current cluster does not have the CRD installed, verify versions from the upstream CRD manifests or official repository before deciding fallbacks.
- Never make users write raw YAML as the only create flow. Provide structured fields, YAML preview, and an advanced YAML edit mode.
- Do not dump large JSON objects in details. Add resource-specific renderers for important spec/status fields, rules, selectors, references, and conditions.

## Discovery Checklist

1. Start from the cluster's authoritative discovery output:
   ```bash
   kubectl api-versions | sort
   kubectl api-resources -o wide
   kubectl api-resources --api-group=<group> -o wide
   ```
   Use this output to capture the exact `APIVERSION`, plural `NAME`, `KIND`, `NAMESPACED`, short names, and supported verbs. Do not infer plural names or scopes from kind names.
2. Query the live API group for machine-readable confirmation:
   ```bash
   kubectl get --raw /apis/<group> | jq
   kubectl get --raw /apis/<group>/<version> | jq '.resources[] | {name, kind, namespaced, verbs}'
   ```
3. For core Kubernetes resources, query `/api/v1` instead of `/apis/<group>/<version>`.
4. For CRDs installed in the cluster, inspect all served versions:
   ```bash
   kubectl get crd <plural>.<group> -o json | jq '.spec.versions[] | {name, served, storage}'
   ```
5. If the CRD is not installed, inspect upstream CRD manifests and record every `spec.versions[].name` where `served: true`.
6. Reconcile the sources in this order: live `api-resources`/`api-versions`, live raw discovery, installed CRD `spec.versions`, then upstream manifests. Document any version that exists upstream but is not served by the current cluster.

## Implementation Checklist

1. Add or update the `ResourceConfig` with primary `listPath`, `resourcePath`, `kind`, scope, create fields, columns, actions, and detail sections.
2. Set the primary `listPath` and `resourcePath` from the `APIVERSION` shown by `kubectl api-resources` for the target resource in the current cluster.
3. Add `listPathAlternates` and `resourcePathAlternates` for every other discovered served version not covered by the primary path.
4. Ensure list, detail, manifest, create, delete, and actions use version-aware paths. A 404 on one version must fall through to the next candidate.
5. Add category pages that show resource families first, then concrete resource types. Hide APIs not served by the cluster instead of showing broken links.
6. Add resource-specific detail rendering for large or nested fields. Put long arrays, rules, routes, selectors, and status blocks on their own rows/cards.
7. Add create/edit forms using human fields for required and common optional fields. The generated YAML must still be previewable and editable in advanced mode.
8. Keep Manifest as a separate route that displays YAML only.

## Verification

Run the checks that match the changed surface:

```bash
cd ui && bun run build
kubectl api-versions | sort
kubectl api-resources -o wide
kubectl api-resources --api-group=<group> -o wide
kubectl get --raw /apis/<group>/<version>
```

Then open the affected dashboard category and at least one list/detail/manifest route. Verify unavailable versions are hidden or skipped, available versions load, and create/delete target the first working served version.
