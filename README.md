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

Now we can deploy the cluster:

```sh
cdktf deploy cluster
```

[![asciicast](https://asciinema.org/a/gKc2ZzGj0TZwsYsi5FVkB7KEo.svg)](https://asciinema.org/a/gKc2ZzGj0TZwsYsi5FVkB7KEo)

## Adding a helm chart to cluster

## Next steps

1. Publish as NPM library
2. Set up CI/CD pipeline

## References

1. [Terraform CDK](https://www.terraform.io/cdktf)
1. [AWS CDK](https://aws.amazon.com/cdk/)
1. [Constructs](https://constructs.dev/)
