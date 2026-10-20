module github.com/jimyag/kubevirt-dashboard

go 1.27

toolchain go1.27.3

require (
	github.com/gorilla/websocket v1.5.3
	github.com/jimmicro/version v1.0.0
	github.com/spf13/cobra v1.10.1
	github.com/spf13/pflag v1.0.10
	golang.org/x/term v0.36.0
	k8s.io/apimachinery v0.32.5
	k8s.io/client-go v0.32.5
	kubevirt.io/api v1.6.2
	kubevirt.io/client-go v1.6.2
	sigs.k8s.io/yaml v1.4.0
)

replace (
	// copy from https://github.com/kubevirt/client-go/blob/0c98b294218fe584ebdead8ed9577f85d919634a/go.mod#L73-L77
	github.com/openshift/api => github.com/openshift/api v0.0.0-20210105115604-44119421ec6b
	k8s.io/kube-openapi => k8s.io/kube-openapi v0.0.0-20240430033511-f0e62f92d13f
)

require (
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/emicklei/go-restful/v3 v3.11.0 // indirect
	github.com/fxamacker/cbor/v2 v2.7.0 // indirect
	github.com/go-kit/log v0.2.1 // indirect
	github.com/go-logfmt/logfmt v0.6.0 // indirect
	github.com/go-logr/logr v1.4.2 // indirect
	github.com/go-openapi/jsonpointer v0.21.0 // indirect
	github.com/go-openapi/jsonreference v0.20.2 // indirect
	github.com/go-openapi/swag v0.23.0 // indirect
	github.com/gogo/protobuf v1.3.2 // indirect
	github.com/golang/protobuf v1.5.4 // indirect
	github.com/google/gnostic-models v0.6.8 // indirect
	github.com/google/go-cmp v0.6.0 // indirect
	github.com/google/gofuzz v1.2.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/josharian/intern v1.0.0 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/k8snetworkplumbingwg/network-attachment-definition-client v0.0.0-20191119172530-79f836b90111 // indirect
	github.com/kubernetes-csi/external-snapshotter/client/v4 v4.2.0 // indirect
	github.com/mailru/easyjson v0.7.7 // indirect
	github.com/moby/spdystream v0.5.0 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.2 // indirect
	github.com/munnerz/goautoneg v0.0.0-20191010083416-a7dc8b61c822 // indirect
	github.com/mxk/go-flowrate v0.0.0-20140419014527-cca7078d478f // indirect
	github.com/openshift/api v0.0.0-20230503133300-8bbcb7ca7183 // indirect
	github.com/openshift/client-go 03a1e773ff3d // indirect
	github.com/openshift/custom-resource-status v1.1.2 // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/prometheus-operator/prometheus-operator/pkg/apis/monitoring v0.68.0 // indirect
	github.com/x448/float16 v0.8.4 // indirect
	go.uber.org/mock v0.5.1 // indirect
	golang.org/x/net v0.38.0 // indirect
	golang.org/x/oauth2 v0.27.0 // indirect
	golang.org/x/sys v0.37.0 // indirect
	golang.org/x/text v0.23.0 // indirect
	golang.org/x/time v0.7.0 // indirect
	google.golang.org/protobuf v1.35.1 // indirect
	gopkg.in/evanphx/json-patch.v4 v4.12.0 // indirect
	gopkg.in/inf.v0 v0.9.1 // indirect
	gopkg.in/yaml.v2 v2.4.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
	k8s.io/api v0.32.5 // indirect
	k8s.io/apiextensions-apiserver v0.32.5 // indirect
	k8s.io/klog/v2 v2.130.1 // indirect
	k8s.io/kube-openapi v0.31.0 // indirect
	k8s.io/utils v0.0.0-20241210054802-24370beab758 // indirect
	kubevirt.io/containerized-data-importer-api v1.63.1 // indirect
	kubevirt.io/controller-lifecycle-operator-sdk/api v0.2.4 // indirect
	sigs.k8s.io/json v0.0.0-20241014173422-cfa47c3a1cc8 // indirect
	sigs.k8s.io/structured-merge-diff/v4 v4.5.0 // indirect
)
