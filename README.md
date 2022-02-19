# CDK TF AKS

In this article we are going to demonstrate benefits of using Terraform CDK to manage Microsoft Azure cloud infrastructure.

## Cloud Development Kit (CDK)

The core idea is using generic programming languages to define infrastructure constructs that then are translated to low-level cloud management primitives (CloudFormation, Terraform JSON). Constructs are combined into shared libraries, and benefits all the features modern development environments provide, such linting, type checks, versioning, testing and release processes.

The growing complexity of cloud infrastructure calls for more advanced approaches to manage it at scale. For example, Azure has over 200 different services, and plenty of options for each, and using programming language with types helps developers catch wrong configurations before deploying ("compile time").


## Setting it up

To start working with CDK TF we need Node.js (>= v14+) and Terraform installed (>= v1.0+). To install the most recent stable release of cdktf, use npm install.

```sh
npm install --global cdktf-cli@latest
```

### Create and initialize the project

```sh
mkdir azure-cdk
cd azure-cdk
cdktf init --template=typescript --local
```

### Adding providers

Add pre-packaged Azure provider:

```sh
npm install @cdktf/provider-azurerm
```

Add generic Helm provider to cdktf.json file:

```json
  "terraformProviders": [
    "helm@~> 2.4.1"
  ],
```

Generate CDK constructs for generic providers:

```sh
cdktf get
```

## Defining and deploying a cluster

Let's deploy new AKS cluster as CDK TF stack, in `main.ts` file:

```typescript
import { App, TerraformStack } from "cdktf"
import { AzurermProvider, KubernetesCluster, ResourceGroup } from "@cdktf/provider-azurerm"

interface ClusterProps {
  region: string
}

class Cluster extends TerraformStack {
  aks: KubernetesCluster
  resourceGroup: ResourceGroup
  constructor(scope: Construct, readonly name: string, readonly props: ClusterProps) {
    super(scope, name)
    new AzurermProvider(this, "azure", { features: {} })
    this.resourceGroup = new ResourceGroup(this, `rg-${name}`, { location: props.region, name: `rg-${name}` })
    this.aks = new KubernetesCluster(this, `aks-${name}`, {
      name: name,
      dependsOn: [this.resourceGroup],
      ...
    }
  }
}

const app = new App()
new Cluster(app, "cluster", { region: "eastus" })
app.synth()
```

Please see the complete source code [here](https://github.com/jamhed/azure-cdk/blob/main/main.ts) and [parameters](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/kubernetes_cluster) guide.

Now we can deploy the cluster named "cluster":

```sh
cdktf deploy cluster
```

[![asciicast](https://asciinema.org/a/gKc2ZzGj0TZwsYsi5FVkB7KEo.svg)](https://asciinema.org/a/gKc2ZzGj0TZwsYsi5FVkB7KEo)

## Adding a helm chart to cluster

Now we have a cluster deployed to Azure, let's add a Helm chart for [External DNS](https://github.com/kubernetes-sigs/external-dns) to it, for simplicity, in the same `main.ts` file:

```typescript
import * as yaml from "js-yaml"
import { HelmProvider, HelmProviderKubernetes, Release } from "./.gen/providers/helm"

interface ChartsProps {
  cluster: Cluster
}

class Charts extends TerraformStack {
  constructor(scope: Construct, readonly name: string, readonly props: ChartsProps) {
    super(scope, name)
    new HelmProvider(this, "helm", {
      kubernetes: props.cluster.aks.kubeConfig("0")
    })
    new AzurermProvider(this, "azure", { features: {} })
  }
}
```

HelmProvider requires Kubernetes cluster configuration data, and we're providing it by referencing a cluster defined in another stack. Unfortunately, some conversion is required, so let's define a function `makeKubeConfig` and do the conversion there:

```typescript
import { App, Fn, TerraformStack } from "cdktf"

function makeKubeConfig(config: KubernetesClusterKubeConfig): HelmProviderKubernetes {
  return {
    host: config.host,
    clientCertificate: Fn.base64decode(config.clientCertificate),
    clientKey: Fn.base64decode(config.clientKey),
    clusterCaCertificate: Fn.base64decode(config.clusterCaCertificate),
    username: config.username,
    password: config.password
  }
}

class Charts extends TerraformStack {
  constructor(scope: Construct, readonly name: string, readonly props: ChartsProps) {
    super(scope, name)
    new HelmProvider(this, "helm", {
      kubernetes: makeKubeConfig(props.cluster.aks.kubeConfig("0"))
    })
    new AzurermProvider(this, "azure", { features: {} })
  }
}
```

Here we use built-in Terraform function `base64decode` to decode values from base64 format to raw values, as expected by the Helm provider.

Now let's add chart to the stack:

```typescript
class Charts extends TerraformStack {
  constructor(scope: Construct, readonly name: string, readonly props: ChartsProps) {
    super(scope, name)
    new HelmProvider(this, "helm", {
      kubernetes: makeKubeConfig(props.cluster.aks.kubeConfig("0"))
    })
    new AzurermProvider(this, "azure", { features: {} })
  }
  addChart(name: string, version: string, repo: string, values: unknown = {}): Release {
    return new Release(this, name, {
      name: name,
      namespace: name,
      repository: repo,
      chart: name,
      version: version,
      createNamespace: true,
      values: [yaml.dump(values)]
    })
  }
  addExternalDns(): Charts {
    const client = new DataAzurermClientConfig(this, "client")
    this.addChart("external-dns", "6.1.2", "https://charts.bitnami.com/bitnami", {
      provider: "azure",
      image: {
        tag: "0.9.0", // 0.10.0 doesn't work with useManagedIdentityExtension
      },
      azure: {
        resourceGroup: this.props.cluster.resourceGroup.name,
        tenantId: client.tenantId,
        subscriptionId: client.subscriptionId,
        useManagedIdentityExtension: true,
        userAssignedIdentityID: this.props.cluster.aks.kubeletIdentity.clientId
      },
      logLevel: "info",
      txtOwnerId: "external-dns",
      sources: ['ingress'],
    })
    return this
  }
}

const app = new App()
const cluster = new Cluster(app, "cluster", { region: "eastus" })
new Charts(app, "charts", { cluster })
app.synth()
```

Here we use `js-yaml` library to provide values to Helm chart in place by converting from json to yaml. Let's deploy the cluster stack again:

```sh
cdktf deploy cluster --auto-approve
```

[![asciicast](https://asciinema.org/a/FP2pPxBcRTRXjcwq8nUOCbVFM.svg)](https://asciinema.org/a/FP2pPxBcRTRXjcwq8nUOCbVFM)

Now we have cross-referenced stack parameters automatically exported by CDK TF, so let's deploy charts stack:

```sh
cdktf deploy charts --auto-approve
```

[![asciicast](https://asciinema.org/a/XkEQEBH0cqKLyUw20OjzBmVj5.svg)](https://asciinema.org/a/XkEQEBH0cqKLyUw20OjzBmVj5)

## Conclusion and next steps

So now we have two CDK TF stacks defined, `cluster` and `charts`, and can work on them independently, however, the code we have so far is not ideal, as all of it is in just one file.

What if we want to deploy multiple Kubernetes clusters, but configured the same way, like having external dns chart always installed?

To accomplish this we'll define a custom CDK TF construct as a Typescript library, and reuse it using standard nodejs package manager npm, in the next article.

## References

1. [Terraform CDK](https://www.terraform.io/cdktf)
1. [AWS CDK](https://aws.amazon.com/cdk/)
1. [Constructs](https://constructs.dev/)
