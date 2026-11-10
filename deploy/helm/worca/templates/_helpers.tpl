{{/*
Naming, labels, images, the controller's environment and the worker pod template.
*/}}

{{- define "worca.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "worca.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "worca.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "worca.instanceId" -}}
{{- default .Release.Name .Values.instanceId -}}
{{- end -}}

{{- define "worca.labels" -}}
helm.sh/chart: {{ include "worca.chart" . }}
app.kubernetes.io/name: {{ include "worca.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: worca
{{- end -}}

{{/* The controller's selector: component included, so worker pods (component: worker) never match. */}}
{{- define "worca.selectorLabels" -}}
app.kubernetes.io/name: {{ include "worca.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: controller
{{- end -}}

{{- define "worca.brokerSelectorLabels" -}}
app.kubernetes.io/name: {{ include "worca.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: broker
{{- end -}}

{{/* Labels every worker pod carries (the backend merges its own on top). */}}
{{- define "worca.workerLabels" -}}
app.kubernetes.io/name: {{ include "worca.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: worker
app.kubernetes.io/part-of: worca
worca.dev/instance: {{ include "worca.instanceId" . }}
{{- end -}}

{{- define "worca.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "worca.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "worca.imageTag" -}}
{{- default .Chart.AppVersion .Values.image.tag -}}
{{- end -}}

{{- define "worca.variantSuffix" -}}
{{- if eq .Values.image.variant "full" -}}-full{{- end -}}
{{- end -}}

{{/* ghcr.io/sinishadjukic/worca:<tag>[-full] */}}
{{- define "worca.controllerImage" -}}
{{- printf "%s/%s:%s%s" .Values.image.registry .Values.image.repository (include "worca.imageTag" .) (include "worca.variantSuffix" .) -}}
{{- end -}}

{{/* ghcr.io/sinishadjukic/worca-worker:{version}-{engine}{variant}: the backend fills the placeholders. */}}
{{- define "worca.workerImagePattern" -}}
{{- printf "%s/%s:%s" .Values.worker.image.registry .Values.worker.image.repository .Values.worker.image.tagPattern -}}
{{- end -}}

{{- define "worca.workerVariant" -}}
{{- default .Values.image.variant .Values.worker.variant -}}
{{- end -}}

{{- define "worca.workersServiceName" -}}
{{- printf "%s-workers" (include "worca.fullname" .) -}}
{{- end -}}

{{- define "worca.brokerServiceName" -}}
{{- printf "%s-broker" (include "worca.fullname" .) -}}
{{- end -}}

{{- define "worca.sharedClaimName" -}}
{{- default (printf "%s-shared" (include "worca.fullname" .)) .Values.storage.shared.existingClaim -}}
{{- end -}}

{{- define "worca.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else if .Values.secrets.create -}}
{{- printf "%s-secrets" (include "worca.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "worca.controllerUrl" -}}
{{- printf "ws://%s.%s.svc:%d" (include "worca.workersServiceName" .) .Release.Namespace (int .Values.controller.workerPort) -}}
{{- end -}}

{{- define "worca.brokerUrl" -}}
{{- printf "http://%s.%s.svc:8080" (include "worca.brokerServiceName" .) .Release.Namespace -}}
{{- end -}}

{{/* Loopback, the -workers Service and the -broker Service: worca's fetch() honours HTTP(S)_PROXY. */}}
{{- define "worca.noProxy" -}}
{{- $w := include "worca.workersServiceName" . -}}
{{- $list := list "127.0.0.1" "localhost" $w (printf "%s.%s.svc" $w .Release.Namespace) -}}
{{- if .Values.broker.enabled -}}
{{- $b := include "worca.brokerServiceName" . -}}
{{- $list = append (append $list $b) (printf "%s.%s.svc" $b .Release.Namespace) -}}
{{- end -}}
{{- if .Values.controller.extraNoProxy -}}
{{- $list = append $list .Values.controller.extraNoProxy -}}
{{- end -}}
{{- join "," $list -}}
{{- end -}}

{{/*
The controller's environment as a name: value map: the chart's entries, then controller.env on
top (it wins on a shared name; NO_PROXY is the chart's). Rendered sorted by name by
"worca.controllerEnv".
*/}}
{{- define "worca.controllerEnvMap" -}}
{{- $env := dict -}}
{{- $_ := set $env "WORCA_EXECUTOR" .Values.controller.executor -}}
{{- $_ := set $env "WORCA_DB_DIR" "/worca-db" -}}
{{- $_ := set $env "WORCA_HOME" "/worca" -}}
{{- $_ := set $env "WORCA_PROJECTS_ROOT" "/projects" -}}
{{- $_ := set $env "WORCA_HOST" "0.0.0.0" -}}
{{- $_ := set $env "PORT" (toString .Values.controller.port) -}}
{{- $_ := set $env "WORCA_INSTANCE_ID" (include "worca.instanceId" .) -}}
{{- $_ := set $env "WORCA_K8S_POD_TEMPLATE" "/etc/worca/worker-pod.json" -}}
{{- $_ := set $env "WORCA_K8S_WORKER_IMAGE" (include "worca.workerImagePattern" .) -}}
{{- $_ := set $env "WORCA_K8S_WORKER_TAG" (include "worca.imageTag" .) -}}
{{- $_ := set $env "WORCA_K8S_WORKER_VARIANT" (include "worca.workerVariant" .) -}}
{{- $_ := set $env "WORCA_K8S_PENDING_TIMEOUT_MS" (toString (mul (int .Values.worker.pendingTimeoutSeconds) 1000)) -}}
{{- $_ := set $env "WORCA_K8S_ACTIVE_DEADLINE_S" (toString .Values.worker.activeDeadlineSeconds) -}}
{{- $_ := set $env "WORCA_K8S_RESOURCES" (toJson .Values.worker.resources) -}}
{{- if .Values.worker.engines -}}
{{- $_ := set $env "WORCA_K8S_ENGINES" (toJson .Values.worker.engines) -}}
{{- end -}}
{{- $_ := set $env "WORCA_WORKER_PORT" (toString .Values.controller.workerPort) -}}
{{- $_ := set $env "WORCA_CONTROLLER_URL" (include "worca.controllerUrl" .) -}}
{{- $_ := set $env "WORCA_WORKER_MAX" (toString .Values.worker.maxWorkers) -}}
{{- $_ := set $env "WORCA_WORKER_CHAT_IDLE_MS" (toString (mul (int .Values.worker.idleTimeoutSeconds) 1000)) -}}
{{- $_ := set $env "WORCA_DRAIN_TIMEOUT_MS" (toString .Values.controller.drainTimeoutMs) -}}
{{- if .Values.broker.enabled -}}
{{- $_ := set $env "WORCA_BROKER_URL" (include "worca.brokerUrl" .) -}}
{{- end -}}
{{- if and .Values.ingress.enabled (not (hasKey .Values.controller.env "WORCA_ALLOWED_HOSTS")) -}}
{{- $hosts := list -}}
{{- range .Values.ingress.hosts -}}{{- if .host -}}{{- $hosts = append $hosts .host -}}{{- end -}}{{- end -}}
{{- if $hosts -}}{{- $_ := set $env "WORCA_ALLOWED_HOSTS" (join "," $hosts) -}}{{- end -}}
{{- end -}}
{{- range $k, $v := .Values.controller.env -}}
{{- $_ := set $env $k (toString $v) -}}
{{- end -}}
{{- $_ := set $env "NO_PROXY" (include "worca.noProxy" .) -}}
{{- toYaml $env -}}
{{- end -}}

{{/* The controller container's `env` list: the map above, sorted, then the namespace fieldRef and controller.extraEnv. */}}
{{- define "worca.controllerEnv" -}}
{{- $env := include "worca.controllerEnvMap" . | fromYaml -}}
{{- range $k := keys $env | sortAlpha }}
- name: {{ $k }}
  value: {{ index $env $k | quote }}
{{- end }}
- name: WORCA_K8S_NAMESPACE
  valueFrom:
    fieldRef:
      fieldPath: metadata.namespace
{{- with .Values.controller.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/* The workers' fixed environment (the backend appends controller URL, token, scope and id). */}}
{{- define "worca.workerEnvMap" -}}
{{- $env := dict -}}
{{- $_ := set $env "WORCA_HOME" "/worca" -}}
{{- $_ := set $env "WORCA_PROJECTS_ROOT" "/projects" -}}
{{- $_ := set $env "WORCA_CONTAINER" "1" -}}
{{- if .Values.broker.enabled -}}
{{- $_ := set $env "WORCA_BROKER_URL" (include "worca.brokerUrl" .) -}}
{{- end -}}
{{- range $k, $v := .Values.worker.env -}}
{{- $_ := set $env $k (toString $v) -}}
{{- end -}}
{{- $_ := set $env "NO_PROXY" (include "worca.noProxy" .) -}}
{{- toYaml $env -}}
{{- end -}}

{{/*
The worker pod template: a complete Pod manifest the backend takes as its starting point. It
overwrites metadata.name, merges its labels, sets the worca.dev/scope annotation, sets the
`worker` container's image, environment (appended) and resources, and enforces
restartPolicy Never, automountServiceAccountToken false and enableServiceLinks false. The
ConfigMap renders this as JSON (worker-pod.json).
*/}}
{{- define "worca.workerPod" -}}
{{- $env := include "worca.workerEnvMap" . | fromYaml -}}
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "worca.fullname" . }}-worker
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "worca.workerLabels" . | nindent 4 }}
    {{- with .Values.worker.podLabels }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
  annotations:
    worca.dev/scope: ""
    {{- with .Values.worker.podAnnotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  restartPolicy: Never
  automountServiceAccountToken: false
  enableServiceLinks: false
  terminationGracePeriodSeconds: {{ .Values.worker.terminationGracePeriodSeconds }}
  {{- with .Values.worker.priorityClassName }}
  priorityClassName: {{ . }}
  {{- end }}
  {{- with .Values.imagePullSecrets }}
  imagePullSecrets:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
    fsGroupChangePolicy: OnRootMismatch
    seccompProfile:
      type: RuntimeDefault
  {{- with .Values.worker.nodeSelector }}
  nodeSelector:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.worker.tolerations }}
  tolerations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.worker.affinity }}
  affinity:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  containers:
    - name: worker
      image: {{ printf "%s/%s:placeholder" .Values.worker.image.registry .Values.worker.image.repository }}
      imagePullPolicy: {{ .Values.image.pullPolicy }}
      env:
        {{- range $k := keys $env | sortAlpha }}
        - name: {{ $k }}
          value: {{ index $env $k | quote }}
        {{- end }}
      {{- if or .Values.worker.credentialsSecret .Values.worker.envFrom }}
      envFrom:
        {{- with .Values.worker.credentialsSecret }}
        - secretRef:
            name: {{ . }}
            optional: true
        {{- end }}
        {{- with .Values.worker.envFrom }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      {{- end }}
      resources:
        {{- toYaml .Values.worker.resources | nindent 8 }}
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: {{ .Values.worker.readOnlyRootFilesystem }}
        capabilities:
          drop: ["ALL"]
      volumeMounts:
        - name: shared
          mountPath: /worca
          subPath: worca
        {{- if .Values.storage.projects.existingClaim }}
        - name: projects
          mountPath: /projects
        {{- else }}
        - name: shared
          mountPath: /projects
          subPath: projects
        {{- end }}
        - name: tmp
          mountPath: /tmp
        - name: shm
          mountPath: /dev/shm
  volumes:
    - name: shared
      persistentVolumeClaim:
        claimName: {{ include "worca.sharedClaimName" . }}
    {{- with .Values.storage.projects.existingClaim }}
    - name: projects
      persistentVolumeClaim:
        claimName: {{ . }}
    {{- end }}
    - name: tmp
      emptyDir:
        sizeLimit: {{ .Values.worker.tmpSizeLimit }}
    - name: shm
      emptyDir:
        medium: Memory
        sizeLimit: {{ .Values.worker.shmSizeLimit }}
{{- end -}}

{{/*
The controller's health probe, run INSIDE the pod against loopback. An httpGet probe comes from the kubelet,
and in local mode the server answers only loopback and the pod's default gateway: on kind or flannel the kubelet
happens to arrive from that gateway, on Calico, the AWS VPC CNI or Azure CNI it does not, and every probe would
get 403 until the pod is restarted forever. From inside, the peer is loopback on every network.
*/}}
{{- define "worca.healthProbe" -}}
exec:
  command: ["curl", "-fsS", "--max-time", "4", "-H", "Host: localhost", "http://127.0.0.1:{{ .Values.controller.port }}/api/health"]
timeoutSeconds: 5
{{- end -}}
