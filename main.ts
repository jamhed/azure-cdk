import { AzurermProvider, DataAzurermClientConfig, KubernetesCluster, KubernetesClusterKubeConfig, ResourceGroup } from "@cdktf/provider-azurerm"
import { App, Fn, TerraformStack } from "cdktf"
import { Construct } from "constructs"
import * as yaml from "js-yaml"
import { HelmProvider, HelmProviderKubernetes, Release } from "./.gen/providers/helm"

interface ClusterProps {
  region: string
}

interface ChartsProps {
  cluster: Cluster
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
      identity: { type: "SystemAssigned" },
      roleBasedAccessControl: { enabled: true },
      dependsOn: [this.resourceGroup],
      dnsPrefix: name,
      location: props.region,
      resourceGroupName: this.resourceGroup.name,
      networkProfile: {
        networkPlugin: "azure",
        networkPolicy: "azure",
        loadBalancerSku: "standard"
      },
      defaultNodePool: {
        name: 'default',
        maxPods: 30,
        vmSize: 'Standard_D4_v2',
        enableAutoScaling: true,
        minCount: 1,
        maxCount: 3
      },
      addonProfile: {
        azurePolicy: { enabled: true }
      }
    })
  }
}

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
    this.addExternalDns()
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
