"use strict";
/* eslint-disable no-console */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClusterResourceHandler = void 0;
const common_1 = require("./common");
const MAX_CLUSTER_NAME_LEN = 100;
class ClusterResourceHandler extends common_1.ResourceHandler {
    constructor(eks, event) {
        super(eks, event);
        this.newProps = parseProps(this.event.ResourceProperties);
        this.oldProps = event.RequestType === 'Update' ? parseProps(event.OldResourceProperties) : {};
    }
    get clusterName() {
        if (!this.physicalResourceId) {
            throw new Error('Cannot determine cluster name without physical resource ID');
        }
        return this.physicalResourceId;
    }
    // ------
    // CREATE
    // ------
    async onCreate() {
        console.log('onCreate: creating cluster with options:', JSON.stringify(this.newProps, undefined, 2));
        if (!this.newProps.roleArn) {
            throw new Error('"roleArn" is required');
        }
        const clusterName = this.newProps.name || this.generateClusterName();
        const resp = await this.eks.createCluster({
            ...this.newProps,
            name: clusterName,
        });
        if (!resp.cluster) {
            throw new Error(`Error when trying to create cluster ${clusterName}: CreateCluster returned without cluster information`);
        }
        return {
            PhysicalResourceId: resp.cluster.name,
        };
    }
    async isCreateComplete() {
        return this.isActive();
    }
    // ------
    // DELETE
    // ------
    async onDelete() {
        console.log(`onDelete: deleting cluster ${this.clusterName}`);
        try {
            await this.eks.deleteCluster({ name: this.clusterName });
        }
        catch (e) {
            if (e.code !== 'ResourceNotFoundException') {
                throw e;
            }
            else {
                console.log(`cluster ${this.clusterName} not found, idempotently succeeded`);
            }
        }
        return {
            PhysicalResourceId: this.clusterName,
        };
    }
    async isDeleteComplete() {
        console.log(`isDeleteComplete: waiting for cluster ${this.clusterName} to be deleted`);
        try {
            const resp = await this.eks.describeCluster({ name: this.clusterName });
            console.log('describeCluster returned:', JSON.stringify(resp, undefined, 2));
        }
        catch (e) {
            if (e.code === 'ResourceNotFoundException') {
                console.log('received ResourceNotFoundException, this means the cluster has been deleted (or never existed)');
                return { IsComplete: true };
            }
            console.log('describeCluster error:', e);
            throw e;
        }
        return {
            IsComplete: false,
        };
    }
    // ------
    // UPDATE
    // ------
    async onUpdate() {
        var _a;
        const updates = analyzeUpdate(this.oldProps, this.newProps);
        console.log('onUpdate:', JSON.stringify({ updates }, undefined, 2));
        // updates to encryption config is not supported
        if (updates.updateEncryption) {
            throw new Error('Cannot update cluster encryption configuration');
        }
        // if there is an update that requires replacement, go ahead and just create
        // a new cluster with the new config. The old cluster will automatically be
        // deleted by cloudformation upon success.
        if (updates.replaceName || updates.replaceRole || updates.replaceVpc) {
            // if we are replacing this cluster and the cluster has an explicit
            // physical name, the creation of the new cluster will fail with "there is
            // already a cluster with that name". this is a common behavior for
            // CloudFormation resources that support specifying a physical name.
            if (this.oldProps.name === this.newProps.name && this.oldProps.name) {
                throw new Error(`Cannot replace cluster "${this.oldProps.name}" since it has an explicit physical name. Either rename the cluster or remove the "name" configuration`);
            }
            return this.onCreate();
        }
        // if a version update is required, issue the version update
        if (updates.updateVersion) {
            if (!this.newProps.version) {
                throw new Error(`Cannot remove cluster version configuration. Current version is ${this.oldProps.version}`);
            }
            return this.updateClusterVersion(this.newProps.version);
        }
        if (updates.updateLogging || updates.updateAccess) {
            const config = {
                name: this.clusterName,
                logging: this.newProps.logging,
            };
            if (updates.updateAccess) {
                // Updating the cluster with securityGroupIds and subnetIds (as specified in the warning here:
                // https://awscli.amazonaws.com/v2/documentation/api/latest/reference/eks/update-cluster-config.html)
                // will fail, therefore we take only the access fields explicitly
                config.resourcesVpcConfig = {
                    endpointPrivateAccess: this.newProps.resourcesVpcConfig.endpointPrivateAccess,
                    endpointPublicAccess: this.newProps.resourcesVpcConfig.endpointPublicAccess,
                    publicAccessCidrs: this.newProps.resourcesVpcConfig.publicAccessCidrs,
                };
            }
            const updateResponse = await this.eks.updateClusterConfig(config);
            return { EksUpdateId: (_a = updateResponse.update) === null || _a === void 0 ? void 0 : _a.id };
        }
        // no updates
        return;
    }
    async isUpdateComplete() {
        console.log('isUpdateComplete');
        // if this is an EKS update, we will monitor the update event itself
        if (this.event.EksUpdateId) {
            const complete = await this.isEksUpdateComplete(this.event.EksUpdateId);
            if (!complete) {
                return { IsComplete: false };
            }
            // fall through: if the update is done, we simply delegate to isActive()
            // in order to extract attributes and state from the cluster itself, which
            // is supposed to be in an ACTIVE state after the update is complete.
        }
        return this.isActive();
    }
    async updateClusterVersion(newVersion) {
        var _a;
        console.log(`updating cluster version to ${newVersion}`);
        // update-cluster-version will fail if we try to update to the same version,
        // so skip in this case.
        const cluster = (await this.eks.describeCluster({ name: this.clusterName })).cluster;
        if ((cluster === null || cluster === void 0 ? void 0 : cluster.version) === newVersion) {
            console.log(`cluster already at version ${cluster.version}, skipping version update`);
            return;
        }
        const updateResponse = await this.eks.updateClusterVersion({ name: this.clusterName, version: newVersion });
        return { EksUpdateId: (_a = updateResponse.update) === null || _a === void 0 ? void 0 : _a.id };
    }
    async isActive() {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        console.log('waiting for cluster to become ACTIVE');
        const resp = await this.eks.describeCluster({ name: this.clusterName });
        console.log('describeCluster result:', JSON.stringify(resp, undefined, 2));
        const cluster = resp.cluster;
        // if cluster is undefined (shouldnt happen) or status is not ACTIVE, we are
        // not complete. note that the custom resource provider framework forbids
        // returning attributes (Data) if isComplete is false.
        if ((cluster === null || cluster === void 0 ? void 0 : cluster.status) === 'FAILED') {
            // not very informative, unfortunately the response doesn't contain any error
            // information :\
            throw new Error('Cluster is in a FAILED status');
        }
        else if ((cluster === null || cluster === void 0 ? void 0 : cluster.status) !== 'ACTIVE') {
            return {
                IsComplete: false,
            };
        }
        else {
            return {
                IsComplete: true,
                Data: {
                    Name: cluster.name,
                    Endpoint: cluster.endpoint,
                    Arn: cluster.arn,
                    // IMPORTANT: CFN expects that attributes will *always* have values,
                    // so return an empty string in case the value is not defined.
                    // Otherwise, CFN will throw with `Vendor response doesn't contain
                    // XXXX key`.
                    CertificateAuthorityData: (_b = (_a = cluster.certificateAuthority) === null || _a === void 0 ? void 0 : _a.data) !== null && _b !== void 0 ? _b : '',
                    ClusterSecurityGroupId: (_d = (_c = cluster.resourcesVpcConfig) === null || _c === void 0 ? void 0 : _c.clusterSecurityGroupId) !== null && _d !== void 0 ? _d : '',
                    OpenIdConnectIssuerUrl: (_g = (_f = (_e = cluster.identity) === null || _e === void 0 ? void 0 : _e.oidc) === null || _f === void 0 ? void 0 : _f.issuer) !== null && _g !== void 0 ? _g : '',
                    OpenIdConnectIssuer: (_l = (_k = (_j = (_h = cluster.identity) === null || _h === void 0 ? void 0 : _h.oidc) === null || _j === void 0 ? void 0 : _j.issuer) === null || _k === void 0 ? void 0 : _k.substring(8)) !== null && _l !== void 0 ? _l : '',
                    // We can safely return the first item from encryption configuration array, because it has a limit of 1 item
                    // https://docs.aws.amazon.com/eks/latest/APIReference/API_CreateCluster.html#AmazonEKS-CreateCluster-request-encryptionConfig
                    EncryptionConfigKeyArn: (_q = (_p = (_o = (_m = cluster.encryptionConfig) === null || _m === void 0 ? void 0 : _m.shift()) === null || _o === void 0 ? void 0 : _o.provider) === null || _p === void 0 ? void 0 : _p.keyArn) !== null && _q !== void 0 ? _q : '',
                },
            };
        }
    }
    async isEksUpdateComplete(eksUpdateId) {
        this.log({ isEksUpdateComplete: eksUpdateId });
        const describeUpdateResponse = await this.eks.describeUpdate({
            name: this.clusterName,
            updateId: eksUpdateId,
        });
        this.log({ describeUpdateResponse });
        if (!describeUpdateResponse.update) {
            throw new Error(`unable to describe update with id "${eksUpdateId}"`);
        }
        switch (describeUpdateResponse.update.status) {
            case 'InProgress':
                return false;
            case 'Successful':
                return true;
            case 'Failed':
            case 'Cancelled':
                throw new Error(`cluster update id "${eksUpdateId}" failed with errors: ${JSON.stringify(describeUpdateResponse.update.errors)}`);
            default:
                throw new Error(`unknown status "${describeUpdateResponse.update.status}" for update id "${eksUpdateId}"`);
        }
    }
    generateClusterName() {
        const suffix = this.requestId.replace(/-/g, ''); // 32 chars
        const prefix = this.logicalResourceId.substr(0, MAX_CLUSTER_NAME_LEN - suffix.length - 1);
        return `${prefix}-${suffix}`;
    }
}
exports.ClusterResourceHandler = ClusterResourceHandler;
function parseProps(props) {
    var _a, _b, _c;
    const parsed = (_a = props === null || props === void 0 ? void 0 : props.Config) !== null && _a !== void 0 ? _a : {};
    // this is weird but these boolean properties are passed by CFN as a string, and we need them to be booleanic for the SDK.
    // Otherwise it fails with 'Unexpected Parameter: params.resourcesVpcConfig.endpointPrivateAccess is expected to be a boolean'
    if (typeof ((_b = parsed.resourcesVpcConfig) === null || _b === void 0 ? void 0 : _b.endpointPrivateAccess) === 'string') {
        parsed.resourcesVpcConfig.endpointPrivateAccess = parsed.resourcesVpcConfig.endpointPrivateAccess === 'true';
    }
    if (typeof ((_c = parsed.resourcesVpcConfig) === null || _c === void 0 ? void 0 : _c.endpointPublicAccess) === 'string') {
        parsed.resourcesVpcConfig.endpointPublicAccess = parsed.resourcesVpcConfig.endpointPublicAccess === 'true';
    }
    return parsed;
}
function analyzeUpdate(oldProps, newProps) {
    var _a, _b;
    console.log('old props: ', JSON.stringify(oldProps));
    console.log('new props: ', JSON.stringify(newProps));
    const newVpcProps = newProps.resourcesVpcConfig || {};
    const oldVpcProps = oldProps.resourcesVpcConfig || {};
    const oldPublicAccessCidrs = new Set((_a = oldVpcProps.publicAccessCidrs) !== null && _a !== void 0 ? _a : []);
    const newPublicAccessCidrs = new Set((_b = newVpcProps.publicAccessCidrs) !== null && _b !== void 0 ? _b : []);
    const newEnc = newProps.encryptionConfig || {};
    const oldEnc = oldProps.encryptionConfig || {};
    return {
        replaceName: newProps.name !== oldProps.name,
        replaceVpc: JSON.stringify(newVpcProps.subnetIds) !== JSON.stringify(oldVpcProps.subnetIds) ||
            JSON.stringify(newVpcProps.securityGroupIds) !== JSON.stringify(oldVpcProps.securityGroupIds),
        updateAccess: newVpcProps.endpointPrivateAccess !== oldVpcProps.endpointPrivateAccess ||
            newVpcProps.endpointPublicAccess !== oldVpcProps.endpointPublicAccess ||
            !setsEqual(newPublicAccessCidrs, oldPublicAccessCidrs),
        replaceRole: newProps.roleArn !== oldProps.roleArn,
        updateVersion: newProps.version !== oldProps.version,
        updateEncryption: JSON.stringify(newEnc) !== JSON.stringify(oldEnc),
        updateLogging: JSON.stringify(newProps.logging) !== JSON.stringify(oldProps.logging),
    };
}
function setsEqual(first, second) {
    return first.size === second.size || [...first].every((e) => second.has(e));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2x1c3Rlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNsdXN0ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLCtCQUErQjs7O0FBTS9CLHFDQUFxRTtBQUVyRSxNQUFNLG9CQUFvQixHQUFHLEdBQUcsQ0FBQztBQUVqQyxNQUFhLHNCQUF1QixTQUFRLHdCQUFlO0lBWXpELFlBQVksR0FBYyxFQUFFLEtBQW9CO1FBQzlDLEtBQUssQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFbEIsSUFBSSxDQUFDLFFBQVEsR0FBRyxVQUFVLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBQzFELElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFdBQVcsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0tBQy9GO0lBaEJELElBQVcsV0FBVztRQUNwQixJQUFJLENBQUMsSUFBSSxDQUFDLGtCQUFrQixFQUFFO1lBQzVCLE1BQU0sSUFBSSxLQUFLLENBQUMsNERBQTRELENBQUMsQ0FBQztTQUMvRTtRQUVELE9BQU8sSUFBSSxDQUFDLGtCQUFrQixDQUFDO0tBQ2hDO0lBWUQsU0FBUztJQUNULFNBQVM7SUFDVCxTQUFTO0lBRUMsS0FBSyxDQUFDLFFBQVE7UUFDdEIsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQ0FBMEMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDckcsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFO1lBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsdUJBQXVCLENBQUMsQ0FBQztTQUMxQztRQUVELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1FBRXJFLE1BQU0sSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUM7WUFDeEMsR0FBRyxJQUFJLENBQUMsUUFBUTtZQUNoQixJQUFJLEVBQUUsV0FBVztTQUNsQixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRTtZQUNqQixNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxXQUFXLHNEQUFzRCxDQUFDLENBQUM7U0FDM0g7UUFFRCxPQUFPO1lBQ0wsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJO1NBQ3RDLENBQUM7S0FDSDtJQUVTLEtBQUssQ0FBQyxnQkFBZ0I7UUFDOUIsT0FBTyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7S0FDeEI7SUFFRCxTQUFTO0lBQ1QsU0FBUztJQUNULFNBQVM7SUFFQyxLQUFLLENBQUMsUUFBUTtRQUN0QixPQUFPLENBQUMsR0FBRyxDQUFDLDhCQUE4QixJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztRQUM5RCxJQUFJO1lBQ0YsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztTQUMxRDtRQUFDLE9BQU8sQ0FBQyxFQUFFO1lBQ1YsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLDJCQUEyQixFQUFFO2dCQUMxQyxNQUFNLENBQUMsQ0FBQzthQUNUO2lCQUFNO2dCQUNMLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLENBQUMsV0FBVyxvQ0FBb0MsQ0FBQyxDQUFDO2FBQzlFO1NBQ0Y7UUFDRCxPQUFPO1lBQ0wsa0JBQWtCLEVBQUUsSUFBSSxDQUFDLFdBQVc7U0FDckMsQ0FBQztLQUNIO0lBRVMsS0FBSyxDQUFDLGdCQUFnQjtRQUM5QixPQUFPLENBQUMsR0FBRyxDQUFDLHlDQUF5QyxJQUFJLENBQUMsV0FBVyxnQkFBZ0IsQ0FBQyxDQUFDO1FBRXZGLElBQUk7WUFDRixNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDO1lBQ3hFLE9BQU8sQ0FBQyxHQUFHLENBQUMsMkJBQTJCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7U0FDOUU7UUFBQyxPQUFPLENBQUMsRUFBRTtZQUNWLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSywyQkFBMkIsRUFBRTtnQkFDMUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnR0FBZ0csQ0FBQyxDQUFDO2dCQUM5RyxPQUFPLEVBQUUsVUFBVSxFQUFFLElBQUksRUFBRSxDQUFDO2FBQzdCO1lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUN6QyxNQUFNLENBQUMsQ0FBQztTQUNUO1FBRUQsT0FBTztZQUNMLFVBQVUsRUFBRSxLQUFLO1NBQ2xCLENBQUM7S0FDSDtJQUVELFNBQVM7SUFDVCxTQUFTO0lBQ1QsU0FBUztJQUVDLEtBQUssQ0FBQyxRQUFROztRQUN0QixNQUFNLE9BQU8sR0FBRyxhQUFhLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDNUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLE9BQU8sRUFBRSxFQUFFLFNBQVMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBRXBFLGdEQUFnRDtRQUNoRCxJQUFJLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRTtZQUM1QixNQUFNLElBQUksS0FBSyxDQUFDLGdEQUFnRCxDQUFDLENBQUM7U0FDbkU7UUFFRCw0RUFBNEU7UUFDNUUsMkVBQTJFO1FBQzNFLDBDQUEwQztRQUMxQyxJQUFJLE9BQU8sQ0FBQyxXQUFXLElBQUksT0FBTyxDQUFDLFdBQVcsSUFBSSxPQUFPLENBQUMsVUFBVSxFQUFFO1lBRXBFLG1FQUFtRTtZQUNuRSwwRUFBMEU7WUFDMUUsbUVBQW1FO1lBQ25FLG9FQUFvRTtZQUNwRSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFO2dCQUNuRSxNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksd0dBQXdHLENBQUMsQ0FBQzthQUN4SztZQUVELE9BQU8sSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1NBQ3hCO1FBRUQsNERBQTREO1FBQzVELElBQUksT0FBTyxDQUFDLGFBQWEsRUFBRTtZQUN6QixJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEVBQUU7Z0JBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsbUVBQW1FLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQzthQUM3RztZQUVELE9BQU8sSUFBSSxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUM7U0FDekQ7UUFFRCxJQUFJLE9BQU8sQ0FBQyxhQUFhLElBQUksT0FBTyxDQUFDLFlBQVksRUFBRTtZQUNqRCxNQUFNLE1BQU0sR0FBdUM7Z0JBQ2pELElBQUksRUFBRSxJQUFJLENBQUMsV0FBVztnQkFDdEIsT0FBTyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTzthQUMvQixDQUFDO1lBQ0YsSUFBSSxPQUFPLENBQUMsWUFBWSxFQUFFO2dCQUN4Qiw4RkFBOEY7Z0JBQzlGLHFHQUFxRztnQkFDckcsaUVBQWlFO2dCQUNqRSxNQUFNLENBQUMsa0JBQWtCLEdBQUc7b0JBQzFCLHFCQUFxQixFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUMscUJBQXFCO29CQUM3RSxvQkFBb0IsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDLG9CQUFvQjtvQkFDM0UsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxpQkFBaUI7aUJBQ3RFLENBQUM7YUFDSDtZQUNELE1BQU0sY0FBYyxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUVsRSxPQUFPLEVBQUUsV0FBVyxRQUFFLGNBQWMsQ0FBQyxNQUFNLDBDQUFFLEVBQUUsRUFBRSxDQUFDO1NBQ25EO1FBRUQsYUFBYTtRQUNiLE9BQU87S0FDUjtJQUVTLEtBQUssQ0FBQyxnQkFBZ0I7UUFDOUIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBRWhDLG9FQUFvRTtRQUNwRSxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFO1lBQzFCLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDeEUsSUFBSSxDQUFDLFFBQVEsRUFBRTtnQkFDYixPQUFPLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxDQUFDO2FBQzlCO1lBRUQsd0VBQXdFO1lBQ3hFLDBFQUEwRTtZQUMxRSxxRUFBcUU7U0FDdEU7UUFFRCxPQUFPLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztLQUN4QjtJQUVPLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxVQUFrQjs7UUFDbkQsT0FBTyxDQUFDLEdBQUcsQ0FBQywrQkFBK0IsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUV6RCw0RUFBNEU7UUFDNUUsd0JBQXdCO1FBQ3hCLE1BQU0sT0FBTyxHQUFHLENBQUMsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQztRQUNyRixJQUFJLENBQUEsT0FBTyxhQUFQLE9BQU8sdUJBQVAsT0FBTyxDQUFFLE9BQU8sTUFBSyxVQUFVLEVBQUU7WUFDbkMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsT0FBTyxDQUFDLE9BQU8sMkJBQTJCLENBQUMsQ0FBQztZQUN0RixPQUFPO1NBQ1I7UUFFRCxNQUFNLGNBQWMsR0FBRyxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsb0JBQW9CLENBQUMsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxPQUFPLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUM1RyxPQUFPLEVBQUUsV0FBVyxRQUFFLGNBQWMsQ0FBQyxNQUFNLDBDQUFFLEVBQUUsRUFBRSxDQUFDO0tBQ25EO0lBRU8sS0FBSyxDQUFDLFFBQVE7O1FBQ3BCLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0NBQXNDLENBQUMsQ0FBQztRQUNwRCxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ3hFLE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDM0UsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQztRQUU3Qiw0RUFBNEU7UUFDNUUseUVBQXlFO1FBQ3pFLHNEQUFzRDtRQUN0RCxJQUFJLENBQUEsT0FBTyxhQUFQLE9BQU8sdUJBQVAsT0FBTyxDQUFFLE1BQU0sTUFBSyxRQUFRLEVBQUU7WUFDaEMsNkVBQTZFO1lBQzdFLGlCQUFpQjtZQUNqQixNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUM7U0FDbEQ7YUFBTSxJQUFJLENBQUEsT0FBTyxhQUFQLE9BQU8sdUJBQVAsT0FBTyxDQUFFLE1BQU0sTUFBSyxRQUFRLEVBQUU7WUFDdkMsT0FBTztnQkFDTCxVQUFVLEVBQUUsS0FBSzthQUNsQixDQUFDO1NBQ0g7YUFBTTtZQUNMLE9BQU87Z0JBQ0wsVUFBVSxFQUFFLElBQUk7Z0JBQ2hCLElBQUksRUFBRTtvQkFDSixJQUFJLEVBQUUsT0FBTyxDQUFDLElBQUk7b0JBQ2xCLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtvQkFDMUIsR0FBRyxFQUFFLE9BQU8sQ0FBQyxHQUFHO29CQUVoQixvRUFBb0U7b0JBQ3BFLDhEQUE4RDtvQkFDOUQsa0VBQWtFO29CQUNsRSxhQUFhO29CQUViLHdCQUF3QixjQUFFLE9BQU8sQ0FBQyxvQkFBb0IsMENBQUUsSUFBSSxtQ0FBSSxFQUFFO29CQUNsRSxzQkFBc0IsY0FBRSxPQUFPLENBQUMsa0JBQWtCLDBDQUFFLHNCQUFzQixtQ0FBSSxFQUFFO29CQUNoRixzQkFBc0Isb0JBQUUsT0FBTyxDQUFDLFFBQVEsMENBQUUsSUFBSSwwQ0FBRSxNQUFNLG1DQUFJLEVBQUU7b0JBQzVELG1CQUFtQiwwQkFBRSxPQUFPLENBQUMsUUFBUSwwQ0FBRSxJQUFJLDBDQUFFLE1BQU0sMENBQUUsU0FBUyxDQUFDLENBQUMsb0NBQUssRUFBRTtvQkFFdkUsNEdBQTRHO29CQUM1Ryw4SEFBOEg7b0JBQzlILHNCQUFzQiwwQkFBRSxPQUFPLENBQUMsZ0JBQWdCLDBDQUFFLEtBQUssNENBQUksUUFBUSwwQ0FBRSxNQUFNLG1DQUFJLEVBQUU7aUJBQ2xGO2FBQ0YsQ0FBQztTQUNIO0tBQ0Y7SUFFTyxLQUFLLENBQUMsbUJBQW1CLENBQUMsV0FBbUI7UUFDbkQsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLG1CQUFtQixFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFFL0MsTUFBTSxzQkFBc0IsR0FBRyxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDO1lBQzNELElBQUksRUFBRSxJQUFJLENBQUMsV0FBVztZQUN0QixRQUFRLEVBQUUsV0FBVztTQUN0QixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsc0JBQXNCLEVBQUUsQ0FBQyxDQUFDO1FBRXJDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxNQUFNLEVBQUU7WUFDbEMsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQ0FBc0MsV0FBVyxHQUFHLENBQUMsQ0FBQztTQUN2RTtRQUVELFFBQVEsc0JBQXNCLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRTtZQUM1QyxLQUFLLFlBQVk7Z0JBQ2YsT0FBTyxLQUFLLENBQUM7WUFDZixLQUFLLFlBQVk7Z0JBQ2YsT0FBTyxJQUFJLENBQUM7WUFDZCxLQUFLLFFBQVEsQ0FBQztZQUNkLEtBQUssV0FBVztnQkFDZCxNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixXQUFXLHlCQUF5QixJQUFJLENBQUMsU0FBUyxDQUFDLHNCQUFzQixDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDcEk7Z0JBQ0UsTUFBTSxJQUFJLEtBQUssQ0FBQyxtQkFBbUIsc0JBQXNCLENBQUMsTUFBTSxDQUFDLE1BQU0sb0JBQW9CLFdBQVcsR0FBRyxDQUFDLENBQUM7U0FDOUc7S0FDRjtJQUVPLG1CQUFtQjtRQUN6QixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxXQUFXO1FBQzVELE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLG9CQUFvQixHQUFHLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDMUYsT0FBTyxHQUFHLE1BQU0sSUFBSSxNQUFNLEVBQUUsQ0FBQztLQUM5QjtDQUNGO0FBcFFELHdEQW9RQztBQUVELFNBQVMsVUFBVSxDQUFDLEtBQVU7O0lBRTVCLE1BQU0sTUFBTSxTQUFHLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxNQUFNLG1DQUFJLEVBQUUsQ0FBQztJQUVuQywwSEFBMEg7SUFDMUgsOEhBQThIO0lBRTlILElBQUksT0FBTyxPQUFDLE1BQU0sQ0FBQyxrQkFBa0IsMENBQUUscUJBQXFCLENBQUMsS0FBSyxRQUFRLEVBQUU7UUFDMUUsTUFBTSxDQUFDLGtCQUFrQixDQUFDLHFCQUFxQixHQUFHLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxxQkFBcUIsS0FBSyxNQUFNLENBQUM7S0FDOUc7SUFFRCxJQUFJLE9BQU8sT0FBQyxNQUFNLENBQUMsa0JBQWtCLDBDQUFFLG9CQUFvQixDQUFDLEtBQUssUUFBUSxFQUFFO1FBQ3pFLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxvQkFBb0IsR0FBRyxNQUFNLENBQUMsa0JBQWtCLENBQUMsb0JBQW9CLEtBQUssTUFBTSxDQUFDO0tBQzVHO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFFaEIsQ0FBQztBQWFELFNBQVMsYUFBYSxDQUFDLFFBQStDLEVBQUUsUUFBc0M7O0lBQzVHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztJQUNyRCxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7SUFFckQsTUFBTSxXQUFXLEdBQUcsUUFBUSxDQUFDLGtCQUFrQixJQUFJLEVBQUUsQ0FBQztJQUN0RCxNQUFNLFdBQVcsR0FBRyxRQUFRLENBQUMsa0JBQWtCLElBQUksRUFBRSxDQUFDO0lBRXRELE1BQU0sb0JBQW9CLEdBQUcsSUFBSSxHQUFHLE9BQUMsV0FBVyxDQUFDLGlCQUFpQixtQ0FBSSxFQUFFLENBQUMsQ0FBQztJQUMxRSxNQUFNLG9CQUFvQixHQUFHLElBQUksR0FBRyxPQUFDLFdBQVcsQ0FBQyxpQkFBaUIsbUNBQUksRUFBRSxDQUFDLENBQUM7SUFDMUUsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLGdCQUFnQixJQUFJLEVBQUUsQ0FBQztJQUMvQyxNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUMsZ0JBQWdCLElBQUksRUFBRSxDQUFDO0lBRS9DLE9BQU87UUFDTCxXQUFXLEVBQUUsUUFBUSxDQUFDLElBQUksS0FBSyxRQUFRLENBQUMsSUFBSTtRQUM1QyxVQUFVLEVBQ1IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDO1lBQy9FLElBQUksQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDLGdCQUFnQixDQUFDLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUMsZ0JBQWdCLENBQUM7UUFDL0YsWUFBWSxFQUNWLFdBQVcsQ0FBQyxxQkFBcUIsS0FBSyxXQUFXLENBQUMscUJBQXFCO1lBQ3ZFLFdBQVcsQ0FBQyxvQkFBb0IsS0FBSyxXQUFXLENBQUMsb0JBQW9CO1lBQ3JFLENBQUMsU0FBUyxDQUFDLG9CQUFvQixFQUFFLG9CQUFvQixDQUFDO1FBQ3hELFdBQVcsRUFBRSxRQUFRLENBQUMsT0FBTyxLQUFLLFFBQVEsQ0FBQyxPQUFPO1FBQ2xELGFBQWEsRUFBRSxRQUFRLENBQUMsT0FBTyxLQUFLLFFBQVEsQ0FBQyxPQUFPO1FBQ3BELGdCQUFnQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEtBQUssSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUM7UUFDbkUsYUFBYSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxLQUFLLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQztLQUNyRixDQUFDO0FBQ0osQ0FBQztBQUVELFNBQVMsU0FBUyxDQUFDLEtBQWtCLEVBQUUsTUFBbUI7SUFDeEQsT0FBTyxLQUFLLENBQUMsSUFBSSxLQUFLLE1BQU0sQ0FBQyxJQUFJLElBQUksQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQ3RGLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiBlc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBpbXBvcnQvbm8tZXh0cmFuZW91cy1kZXBlbmRlbmNpZXNcbmltcG9ydCB7IElzQ29tcGxldGVSZXNwb25zZSwgT25FdmVudFJlc3BvbnNlIH0gZnJvbSAnLi4vLi4vLi4vY3VzdG9tLXJlc291cmNlcy9saWIvcHJvdmlkZXItZnJhbWV3b3JrL3R5cGVzJztcbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBpbXBvcnQvbm8tZXh0cmFuZW91cy1kZXBlbmRlbmNpZXNcbmltcG9ydCAqIGFzIGF3cyBmcm9tICdhd3Mtc2RrJztcbmltcG9ydCB7IEVrc0NsaWVudCwgUmVzb3VyY2VFdmVudCwgUmVzb3VyY2VIYW5kbGVyIH0gZnJvbSAnLi9jb21tb24nO1xuXG5jb25zdCBNQVhfQ0xVU1RFUl9OQU1FX0xFTiA9IDEwMDtcblxuZXhwb3J0IGNsYXNzIENsdXN0ZXJSZXNvdXJjZUhhbmRsZXIgZXh0ZW5kcyBSZXNvdXJjZUhhbmRsZXIge1xuICBwdWJsaWMgZ2V0IGNsdXN0ZXJOYW1lKCkge1xuICAgIGlmICghdGhpcy5waHlzaWNhbFJlc291cmNlSWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGRldGVybWluZSBjbHVzdGVyIG5hbWUgd2l0aG91dCBwaHlzaWNhbCByZXNvdXJjZSBJRCcpO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnBoeXNpY2FsUmVzb3VyY2VJZDtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZG9ubHkgbmV3UHJvcHM6IGF3cy5FS1MuQ3JlYXRlQ2x1c3RlclJlcXVlc3Q7XG4gIHByaXZhdGUgcmVhZG9ubHkgb2xkUHJvcHM6IFBhcnRpYWw8YXdzLkVLUy5DcmVhdGVDbHVzdGVyUmVxdWVzdD47XG5cbiAgY29uc3RydWN0b3IoZWtzOiBFa3NDbGllbnQsIGV2ZW50OiBSZXNvdXJjZUV2ZW50KSB7XG4gICAgc3VwZXIoZWtzLCBldmVudCk7XG5cbiAgICB0aGlzLm5ld1Byb3BzID0gcGFyc2VQcm9wcyh0aGlzLmV2ZW50LlJlc291cmNlUHJvcGVydGllcyk7XG4gICAgdGhpcy5vbGRQcm9wcyA9IGV2ZW50LlJlcXVlc3RUeXBlID09PSAnVXBkYXRlJyA/IHBhcnNlUHJvcHMoZXZlbnQuT2xkUmVzb3VyY2VQcm9wZXJ0aWVzKSA6IHt9O1xuICB9XG5cbiAgLy8gLS0tLS0tXG4gIC8vIENSRUFURVxuICAvLyAtLS0tLS1cblxuICBwcm90ZWN0ZWQgYXN5bmMgb25DcmVhdGUoKTogUHJvbWlzZTxPbkV2ZW50UmVzcG9uc2U+IHtcbiAgICBjb25zb2xlLmxvZygnb25DcmVhdGU6IGNyZWF0aW5nIGNsdXN0ZXIgd2l0aCBvcHRpb25zOicsIEpTT04uc3RyaW5naWZ5KHRoaXMubmV3UHJvcHMsIHVuZGVmaW5lZCwgMikpO1xuICAgIGlmICghdGhpcy5uZXdQcm9wcy5yb2xlQXJuKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1wicm9sZUFyblwiIGlzIHJlcXVpcmVkJyk7XG4gICAgfVxuXG4gICAgY29uc3QgY2x1c3Rlck5hbWUgPSB0aGlzLm5ld1Byb3BzLm5hbWUgfHwgdGhpcy5nZW5lcmF0ZUNsdXN0ZXJOYW1lKCk7XG5cbiAgICBjb25zdCByZXNwID0gYXdhaXQgdGhpcy5la3MuY3JlYXRlQ2x1c3Rlcih7XG4gICAgICAuLi50aGlzLm5ld1Byb3BzLFxuICAgICAgbmFtZTogY2x1c3Rlck5hbWUsXG4gICAgfSk7XG5cbiAgICBpZiAoIXJlc3AuY2x1c3Rlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciB3aGVuIHRyeWluZyB0byBjcmVhdGUgY2x1c3RlciAke2NsdXN0ZXJOYW1lfTogQ3JlYXRlQ2x1c3RlciByZXR1cm5lZCB3aXRob3V0IGNsdXN0ZXIgaW5mb3JtYXRpb25gKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgUGh5c2ljYWxSZXNvdXJjZUlkOiByZXNwLmNsdXN0ZXIubmFtZSxcbiAgICB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGlzQ3JlYXRlQ29tcGxldGUoKSB7XG4gICAgcmV0dXJuIHRoaXMuaXNBY3RpdmUoKTtcbiAgfVxuXG4gIC8vIC0tLS0tLVxuICAvLyBERUxFVEVcbiAgLy8gLS0tLS0tXG5cbiAgcHJvdGVjdGVkIGFzeW5jIG9uRGVsZXRlKCk6IFByb21pc2U8T25FdmVudFJlc3BvbnNlPiB7XG4gICAgY29uc29sZS5sb2coYG9uRGVsZXRlOiBkZWxldGluZyBjbHVzdGVyICR7dGhpcy5jbHVzdGVyTmFtZX1gKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5la3MuZGVsZXRlQ2x1c3Rlcih7IG5hbWU6IHRoaXMuY2x1c3Rlck5hbWUgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKGUuY29kZSAhPT0gJ1Jlc291cmNlTm90Rm91bmRFeGNlcHRpb24nKSB7XG4gICAgICAgIHRocm93IGU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmxvZyhgY2x1c3RlciAke3RoaXMuY2x1c3Rlck5hbWV9IG5vdCBmb3VuZCwgaWRlbXBvdGVudGx5IHN1Y2NlZWRlZGApO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgUGh5c2ljYWxSZXNvdXJjZUlkOiB0aGlzLmNsdXN0ZXJOYW1lLFxuICAgIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgaXNEZWxldGVDb21wbGV0ZSgpOiBQcm9taXNlPElzQ29tcGxldGVSZXNwb25zZT4ge1xuICAgIGNvbnNvbGUubG9nKGBpc0RlbGV0ZUNvbXBsZXRlOiB3YWl0aW5nIGZvciBjbHVzdGVyICR7dGhpcy5jbHVzdGVyTmFtZX0gdG8gYmUgZGVsZXRlZGApO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmVrcy5kZXNjcmliZUNsdXN0ZXIoeyBuYW1lOiB0aGlzLmNsdXN0ZXJOYW1lIH0pO1xuICAgICAgY29uc29sZS5sb2coJ2Rlc2NyaWJlQ2x1c3RlciByZXR1cm5lZDonLCBKU09OLnN0cmluZ2lmeShyZXNwLCB1bmRlZmluZWQsIDIpKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoZS5jb2RlID09PSAnUmVzb3VyY2VOb3RGb3VuZEV4Y2VwdGlvbicpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ3JlY2VpdmVkIFJlc291cmNlTm90Rm91bmRFeGNlcHRpb24sIHRoaXMgbWVhbnMgdGhlIGNsdXN0ZXIgaGFzIGJlZW4gZGVsZXRlZCAob3IgbmV2ZXIgZXhpc3RlZCknKTtcbiAgICAgICAgcmV0dXJuIHsgSXNDb21wbGV0ZTogdHJ1ZSB9O1xuICAgICAgfVxuXG4gICAgICBjb25zb2xlLmxvZygnZGVzY3JpYmVDbHVzdGVyIGVycm9yOicsIGUpO1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgSXNDb21wbGV0ZTogZmFsc2UsXG4gICAgfTtcbiAgfVxuXG4gIC8vIC0tLS0tLVxuICAvLyBVUERBVEVcbiAgLy8gLS0tLS0tXG5cbiAgcHJvdGVjdGVkIGFzeW5jIG9uVXBkYXRlKCkge1xuICAgIGNvbnN0IHVwZGF0ZXMgPSBhbmFseXplVXBkYXRlKHRoaXMub2xkUHJvcHMsIHRoaXMubmV3UHJvcHMpO1xuICAgIGNvbnNvbGUubG9nKCdvblVwZGF0ZTonLCBKU09OLnN0cmluZ2lmeSh7IHVwZGF0ZXMgfSwgdW5kZWZpbmVkLCAyKSk7XG5cbiAgICAvLyB1cGRhdGVzIHRvIGVuY3J5cHRpb24gY29uZmlnIGlzIG5vdCBzdXBwb3J0ZWRcbiAgICBpZiAodXBkYXRlcy51cGRhdGVFbmNyeXB0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCB1cGRhdGUgY2x1c3RlciBlbmNyeXB0aW9uIGNvbmZpZ3VyYXRpb24nKTtcbiAgICB9XG5cbiAgICAvLyBpZiB0aGVyZSBpcyBhbiB1cGRhdGUgdGhhdCByZXF1aXJlcyByZXBsYWNlbWVudCwgZ28gYWhlYWQgYW5kIGp1c3QgY3JlYXRlXG4gICAgLy8gYSBuZXcgY2x1c3RlciB3aXRoIHRoZSBuZXcgY29uZmlnLiBUaGUgb2xkIGNsdXN0ZXIgd2lsbCBhdXRvbWF0aWNhbGx5IGJlXG4gICAgLy8gZGVsZXRlZCBieSBjbG91ZGZvcm1hdGlvbiB1cG9uIHN1Y2Nlc3MuXG4gICAgaWYgKHVwZGF0ZXMucmVwbGFjZU5hbWUgfHwgdXBkYXRlcy5yZXBsYWNlUm9sZSB8fCB1cGRhdGVzLnJlcGxhY2VWcGMpIHtcblxuICAgICAgLy8gaWYgd2UgYXJlIHJlcGxhY2luZyB0aGlzIGNsdXN0ZXIgYW5kIHRoZSBjbHVzdGVyIGhhcyBhbiBleHBsaWNpdFxuICAgICAgLy8gcGh5c2ljYWwgbmFtZSwgdGhlIGNyZWF0aW9uIG9mIHRoZSBuZXcgY2x1c3RlciB3aWxsIGZhaWwgd2l0aCBcInRoZXJlIGlzXG4gICAgICAvLyBhbHJlYWR5IGEgY2x1c3RlciB3aXRoIHRoYXQgbmFtZVwiLiB0aGlzIGlzIGEgY29tbW9uIGJlaGF2aW9yIGZvclxuICAgICAgLy8gQ2xvdWRGb3JtYXRpb24gcmVzb3VyY2VzIHRoYXQgc3VwcG9ydCBzcGVjaWZ5aW5nIGEgcGh5c2ljYWwgbmFtZS5cbiAgICAgIGlmICh0aGlzLm9sZFByb3BzLm5hbWUgPT09IHRoaXMubmV3UHJvcHMubmFtZSAmJiB0aGlzLm9sZFByb3BzLm5hbWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmVwbGFjZSBjbHVzdGVyIFwiJHt0aGlzLm9sZFByb3BzLm5hbWV9XCIgc2luY2UgaXQgaGFzIGFuIGV4cGxpY2l0IHBoeXNpY2FsIG5hbWUuIEVpdGhlciByZW5hbWUgdGhlIGNsdXN0ZXIgb3IgcmVtb3ZlIHRoZSBcIm5hbWVcIiBjb25maWd1cmF0aW9uYCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLm9uQ3JlYXRlKCk7XG4gICAgfVxuXG4gICAgLy8gaWYgYSB2ZXJzaW9uIHVwZGF0ZSBpcyByZXF1aXJlZCwgaXNzdWUgdGhlIHZlcnNpb24gdXBkYXRlXG4gICAgaWYgKHVwZGF0ZXMudXBkYXRlVmVyc2lvbikge1xuICAgICAgaWYgKCF0aGlzLm5ld1Byb3BzLnZlcnNpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgcmVtb3ZlIGNsdXN0ZXIgdmVyc2lvbiBjb25maWd1cmF0aW9uLiBDdXJyZW50IHZlcnNpb24gaXMgJHt0aGlzLm9sZFByb3BzLnZlcnNpb259YCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLnVwZGF0ZUNsdXN0ZXJWZXJzaW9uKHRoaXMubmV3UHJvcHMudmVyc2lvbik7XG4gICAgfVxuXG4gICAgaWYgKHVwZGF0ZXMudXBkYXRlTG9nZ2luZyB8fCB1cGRhdGVzLnVwZGF0ZUFjY2Vzcykge1xuICAgICAgY29uc3QgY29uZmlnOiBhd3MuRUtTLlVwZGF0ZUNsdXN0ZXJDb25maWdSZXF1ZXN0ID0ge1xuICAgICAgICBuYW1lOiB0aGlzLmNsdXN0ZXJOYW1lLFxuICAgICAgICBsb2dnaW5nOiB0aGlzLm5ld1Byb3BzLmxvZ2dpbmcsXG4gICAgICB9O1xuICAgICAgaWYgKHVwZGF0ZXMudXBkYXRlQWNjZXNzKSB7XG4gICAgICAgIC8vIFVwZGF0aW5nIHRoZSBjbHVzdGVyIHdpdGggc2VjdXJpdHlHcm91cElkcyBhbmQgc3VibmV0SWRzIChhcyBzcGVjaWZpZWQgaW4gdGhlIHdhcm5pbmcgaGVyZTpcbiAgICAgICAgLy8gaHR0cHM6Ly9hd3NjbGkuYW1hem9uYXdzLmNvbS92Mi9kb2N1bWVudGF0aW9uL2FwaS9sYXRlc3QvcmVmZXJlbmNlL2Vrcy91cGRhdGUtY2x1c3Rlci1jb25maWcuaHRtbClcbiAgICAgICAgLy8gd2lsbCBmYWlsLCB0aGVyZWZvcmUgd2UgdGFrZSBvbmx5IHRoZSBhY2Nlc3MgZmllbGRzIGV4cGxpY2l0bHlcbiAgICAgICAgY29uZmlnLnJlc291cmNlc1ZwY0NvbmZpZyA9IHtcbiAgICAgICAgICBlbmRwb2ludFByaXZhdGVBY2Nlc3M6IHRoaXMubmV3UHJvcHMucmVzb3VyY2VzVnBjQ29uZmlnLmVuZHBvaW50UHJpdmF0ZUFjY2VzcyxcbiAgICAgICAgICBlbmRwb2ludFB1YmxpY0FjY2VzczogdGhpcy5uZXdQcm9wcy5yZXNvdXJjZXNWcGNDb25maWcuZW5kcG9pbnRQdWJsaWNBY2Nlc3MsXG4gICAgICAgICAgcHVibGljQWNjZXNzQ2lkcnM6IHRoaXMubmV3UHJvcHMucmVzb3VyY2VzVnBjQ29uZmlnLnB1YmxpY0FjY2Vzc0NpZHJzLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgY29uc3QgdXBkYXRlUmVzcG9uc2UgPSBhd2FpdCB0aGlzLmVrcy51cGRhdGVDbHVzdGVyQ29uZmlnKGNvbmZpZyk7XG5cbiAgICAgIHJldHVybiB7IEVrc1VwZGF0ZUlkOiB1cGRhdGVSZXNwb25zZS51cGRhdGU/LmlkIH07XG4gICAgfVxuXG4gICAgLy8gbm8gdXBkYXRlc1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBpc1VwZGF0ZUNvbXBsZXRlKCkge1xuICAgIGNvbnNvbGUubG9nKCdpc1VwZGF0ZUNvbXBsZXRlJyk7XG5cbiAgICAvLyBpZiB0aGlzIGlzIGFuIEVLUyB1cGRhdGUsIHdlIHdpbGwgbW9uaXRvciB0aGUgdXBkYXRlIGV2ZW50IGl0c2VsZlxuICAgIGlmICh0aGlzLmV2ZW50LkVrc1VwZGF0ZUlkKSB7XG4gICAgICBjb25zdCBjb21wbGV0ZSA9IGF3YWl0IHRoaXMuaXNFa3NVcGRhdGVDb21wbGV0ZSh0aGlzLmV2ZW50LkVrc1VwZGF0ZUlkKTtcbiAgICAgIGlmICghY29tcGxldGUpIHtcbiAgICAgICAgcmV0dXJuIHsgSXNDb21wbGV0ZTogZmFsc2UgfTtcbiAgICAgIH1cblxuICAgICAgLy8gZmFsbCB0aHJvdWdoOiBpZiB0aGUgdXBkYXRlIGlzIGRvbmUsIHdlIHNpbXBseSBkZWxlZ2F0ZSB0byBpc0FjdGl2ZSgpXG4gICAgICAvLyBpbiBvcmRlciB0byBleHRyYWN0IGF0dHJpYnV0ZXMgYW5kIHN0YXRlIGZyb20gdGhlIGNsdXN0ZXIgaXRzZWxmLCB3aGljaFxuICAgICAgLy8gaXMgc3VwcG9zZWQgdG8gYmUgaW4gYW4gQUNUSVZFIHN0YXRlIGFmdGVyIHRoZSB1cGRhdGUgaXMgY29tcGxldGUuXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuaXNBY3RpdmUoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlQ2x1c3RlclZlcnNpb24obmV3VmVyc2lvbjogc3RyaW5nKSB7XG4gICAgY29uc29sZS5sb2coYHVwZGF0aW5nIGNsdXN0ZXIgdmVyc2lvbiB0byAke25ld1ZlcnNpb259YCk7XG5cbiAgICAvLyB1cGRhdGUtY2x1c3Rlci12ZXJzaW9uIHdpbGwgZmFpbCBpZiB3ZSB0cnkgdG8gdXBkYXRlIHRvIHRoZSBzYW1lIHZlcnNpb24sXG4gICAgLy8gc28gc2tpcCBpbiB0aGlzIGNhc2UuXG4gICAgY29uc3QgY2x1c3RlciA9IChhd2FpdCB0aGlzLmVrcy5kZXNjcmliZUNsdXN0ZXIoeyBuYW1lOiB0aGlzLmNsdXN0ZXJOYW1lIH0pKS5jbHVzdGVyO1xuICAgIGlmIChjbHVzdGVyPy52ZXJzaW9uID09PSBuZXdWZXJzaW9uKSB7XG4gICAgICBjb25zb2xlLmxvZyhgY2x1c3RlciBhbHJlYWR5IGF0IHZlcnNpb24gJHtjbHVzdGVyLnZlcnNpb259LCBza2lwcGluZyB2ZXJzaW9uIHVwZGF0ZWApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHVwZGF0ZVJlc3BvbnNlID0gYXdhaXQgdGhpcy5la3MudXBkYXRlQ2x1c3RlclZlcnNpb24oeyBuYW1lOiB0aGlzLmNsdXN0ZXJOYW1lLCB2ZXJzaW9uOiBuZXdWZXJzaW9uIH0pO1xuICAgIHJldHVybiB7IEVrc1VwZGF0ZUlkOiB1cGRhdGVSZXNwb25zZS51cGRhdGU/LmlkIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGlzQWN0aXZlKCk6IFByb21pc2U8SXNDb21wbGV0ZVJlc3BvbnNlPiB7XG4gICAgY29uc29sZS5sb2coJ3dhaXRpbmcgZm9yIGNsdXN0ZXIgdG8gYmVjb21lIEFDVElWRScpO1xuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB0aGlzLmVrcy5kZXNjcmliZUNsdXN0ZXIoeyBuYW1lOiB0aGlzLmNsdXN0ZXJOYW1lIH0pO1xuICAgIGNvbnNvbGUubG9nKCdkZXNjcmliZUNsdXN0ZXIgcmVzdWx0OicsIEpTT04uc3RyaW5naWZ5KHJlc3AsIHVuZGVmaW5lZCwgMikpO1xuICAgIGNvbnN0IGNsdXN0ZXIgPSByZXNwLmNsdXN0ZXI7XG5cbiAgICAvLyBpZiBjbHVzdGVyIGlzIHVuZGVmaW5lZCAoc2hvdWxkbnQgaGFwcGVuKSBvciBzdGF0dXMgaXMgbm90IEFDVElWRSwgd2UgYXJlXG4gICAgLy8gbm90IGNvbXBsZXRlLiBub3RlIHRoYXQgdGhlIGN1c3RvbSByZXNvdXJjZSBwcm92aWRlciBmcmFtZXdvcmsgZm9yYmlkc1xuICAgIC8vIHJldHVybmluZyBhdHRyaWJ1dGVzIChEYXRhKSBpZiBpc0NvbXBsZXRlIGlzIGZhbHNlLlxuICAgIGlmIChjbHVzdGVyPy5zdGF0dXMgPT09ICdGQUlMRUQnKSB7XG4gICAgICAvLyBub3QgdmVyeSBpbmZvcm1hdGl2ZSwgdW5mb3J0dW5hdGVseSB0aGUgcmVzcG9uc2UgZG9lc24ndCBjb250YWluIGFueSBlcnJvclxuICAgICAgLy8gaW5mb3JtYXRpb24gOlxcXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NsdXN0ZXIgaXMgaW4gYSBGQUlMRUQgc3RhdHVzJyk7XG4gICAgfSBlbHNlIGlmIChjbHVzdGVyPy5zdGF0dXMgIT09ICdBQ1RJVkUnKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBJc0NvbXBsZXRlOiBmYWxzZSxcbiAgICAgIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIElzQ29tcGxldGU6IHRydWUsXG4gICAgICAgIERhdGE6IHtcbiAgICAgICAgICBOYW1lOiBjbHVzdGVyLm5hbWUsXG4gICAgICAgICAgRW5kcG9pbnQ6IGNsdXN0ZXIuZW5kcG9pbnQsXG4gICAgICAgICAgQXJuOiBjbHVzdGVyLmFybixcblxuICAgICAgICAgIC8vIElNUE9SVEFOVDogQ0ZOIGV4cGVjdHMgdGhhdCBhdHRyaWJ1dGVzIHdpbGwgKmFsd2F5cyogaGF2ZSB2YWx1ZXMsXG4gICAgICAgICAgLy8gc28gcmV0dXJuIGFuIGVtcHR5IHN0cmluZyBpbiBjYXNlIHRoZSB2YWx1ZSBpcyBub3QgZGVmaW5lZC5cbiAgICAgICAgICAvLyBPdGhlcndpc2UsIENGTiB3aWxsIHRocm93IHdpdGggYFZlbmRvciByZXNwb25zZSBkb2Vzbid0IGNvbnRhaW5cbiAgICAgICAgICAvLyBYWFhYIGtleWAuXG5cbiAgICAgICAgICBDZXJ0aWZpY2F0ZUF1dGhvcml0eURhdGE6IGNsdXN0ZXIuY2VydGlmaWNhdGVBdXRob3JpdHk/LmRhdGEgPz8gJycsXG4gICAgICAgICAgQ2x1c3RlclNlY3VyaXR5R3JvdXBJZDogY2x1c3Rlci5yZXNvdXJjZXNWcGNDb25maWc/LmNsdXN0ZXJTZWN1cml0eUdyb3VwSWQgPz8gJycsXG4gICAgICAgICAgT3BlbklkQ29ubmVjdElzc3VlclVybDogY2x1c3Rlci5pZGVudGl0eT8ub2lkYz8uaXNzdWVyID8/ICcnLFxuICAgICAgICAgIE9wZW5JZENvbm5lY3RJc3N1ZXI6IGNsdXN0ZXIuaWRlbnRpdHk/Lm9pZGM/Lmlzc3Vlcj8uc3Vic3RyaW5nKDgpID8/ICcnLCAvLyBTdHJpcHMgb2ZmIGh0dHBzOi8vIGZyb20gdGhlIGlzc3VlciB1cmxcblxuICAgICAgICAgIC8vIFdlIGNhbiBzYWZlbHkgcmV0dXJuIHRoZSBmaXJzdCBpdGVtIGZyb20gZW5jcnlwdGlvbiBjb25maWd1cmF0aW9uIGFycmF5LCBiZWNhdXNlIGl0IGhhcyBhIGxpbWl0IG9mIDEgaXRlbVxuICAgICAgICAgIC8vIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9la3MvbGF0ZXN0L0FQSVJlZmVyZW5jZS9BUElfQ3JlYXRlQ2x1c3Rlci5odG1sI0FtYXpvbkVLUy1DcmVhdGVDbHVzdGVyLXJlcXVlc3QtZW5jcnlwdGlvbkNvbmZpZ1xuICAgICAgICAgIEVuY3J5cHRpb25Db25maWdLZXlBcm46IGNsdXN0ZXIuZW5jcnlwdGlvbkNvbmZpZz8uc2hpZnQoKT8ucHJvdmlkZXI/LmtleUFybiA/PyAnJyxcbiAgICAgICAgfSxcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBpc0Vrc1VwZGF0ZUNvbXBsZXRlKGVrc1VwZGF0ZUlkOiBzdHJpbmcpIHtcbiAgICB0aGlzLmxvZyh7IGlzRWtzVXBkYXRlQ29tcGxldGU6IGVrc1VwZGF0ZUlkIH0pO1xuXG4gICAgY29uc3QgZGVzY3JpYmVVcGRhdGVSZXNwb25zZSA9IGF3YWl0IHRoaXMuZWtzLmRlc2NyaWJlVXBkYXRlKHtcbiAgICAgIG5hbWU6IHRoaXMuY2x1c3Rlck5hbWUsXG4gICAgICB1cGRhdGVJZDogZWtzVXBkYXRlSWQsXG4gICAgfSk7XG5cbiAgICB0aGlzLmxvZyh7IGRlc2NyaWJlVXBkYXRlUmVzcG9uc2UgfSk7XG5cbiAgICBpZiAoIWRlc2NyaWJlVXBkYXRlUmVzcG9uc2UudXBkYXRlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHVuYWJsZSB0byBkZXNjcmliZSB1cGRhdGUgd2l0aCBpZCBcIiR7ZWtzVXBkYXRlSWR9XCJgKTtcbiAgICB9XG5cbiAgICBzd2l0Y2ggKGRlc2NyaWJlVXBkYXRlUmVzcG9uc2UudXBkYXRlLnN0YXR1cykge1xuICAgICAgY2FzZSAnSW5Qcm9ncmVzcyc6XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIGNhc2UgJ1N1Y2Nlc3NmdWwnOlxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIGNhc2UgJ0ZhaWxlZCc6XG4gICAgICBjYXNlICdDYW5jZWxsZWQnOlxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGNsdXN0ZXIgdXBkYXRlIGlkIFwiJHtla3NVcGRhdGVJZH1cIiBmYWlsZWQgd2l0aCBlcnJvcnM6ICR7SlNPTi5zdHJpbmdpZnkoZGVzY3JpYmVVcGRhdGVSZXNwb25zZS51cGRhdGUuZXJyb3JzKX1gKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgdW5rbm93biBzdGF0dXMgXCIke2Rlc2NyaWJlVXBkYXRlUmVzcG9uc2UudXBkYXRlLnN0YXR1c31cIiBmb3IgdXBkYXRlIGlkIFwiJHtla3NVcGRhdGVJZH1cImApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZ2VuZXJhdGVDbHVzdGVyTmFtZSgpIHtcbiAgICBjb25zdCBzdWZmaXggPSB0aGlzLnJlcXVlc3RJZC5yZXBsYWNlKC8tL2csICcnKTsgLy8gMzIgY2hhcnNcbiAgICBjb25zdCBwcmVmaXggPSB0aGlzLmxvZ2ljYWxSZXNvdXJjZUlkLnN1YnN0cigwLCBNQVhfQ0xVU1RFUl9OQU1FX0xFTiAtIHN1ZmZpeC5sZW5ndGggLSAxKTtcbiAgICByZXR1cm4gYCR7cHJlZml4fS0ke3N1ZmZpeH1gO1xuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlUHJvcHMocHJvcHM6IGFueSk6IGF3cy5FS1MuQ3JlYXRlQ2x1c3RlclJlcXVlc3Qge1xuXG4gIGNvbnN0IHBhcnNlZCA9IHByb3BzPy5Db25maWcgPz8ge307XG5cbiAgLy8gdGhpcyBpcyB3ZWlyZCBidXQgdGhlc2UgYm9vbGVhbiBwcm9wZXJ0aWVzIGFyZSBwYXNzZWQgYnkgQ0ZOIGFzIGEgc3RyaW5nLCBhbmQgd2UgbmVlZCB0aGVtIHRvIGJlIGJvb2xlYW5pYyBmb3IgdGhlIFNESy5cbiAgLy8gT3RoZXJ3aXNlIGl0IGZhaWxzIHdpdGggJ1VuZXhwZWN0ZWQgUGFyYW1ldGVyOiBwYXJhbXMucmVzb3VyY2VzVnBjQ29uZmlnLmVuZHBvaW50UHJpdmF0ZUFjY2VzcyBpcyBleHBlY3RlZCB0byBiZSBhIGJvb2xlYW4nXG5cbiAgaWYgKHR5cGVvZiAocGFyc2VkLnJlc291cmNlc1ZwY0NvbmZpZz8uZW5kcG9pbnRQcml2YXRlQWNjZXNzKSA9PT0gJ3N0cmluZycpIHtcbiAgICBwYXJzZWQucmVzb3VyY2VzVnBjQ29uZmlnLmVuZHBvaW50UHJpdmF0ZUFjY2VzcyA9IHBhcnNlZC5yZXNvdXJjZXNWcGNDb25maWcuZW5kcG9pbnRQcml2YXRlQWNjZXNzID09PSAndHJ1ZSc7XG4gIH1cblxuICBpZiAodHlwZW9mIChwYXJzZWQucmVzb3VyY2VzVnBjQ29uZmlnPy5lbmRwb2ludFB1YmxpY0FjY2VzcykgPT09ICdzdHJpbmcnKSB7XG4gICAgcGFyc2VkLnJlc291cmNlc1ZwY0NvbmZpZy5lbmRwb2ludFB1YmxpY0FjY2VzcyA9IHBhcnNlZC5yZXNvdXJjZXNWcGNDb25maWcuZW5kcG9pbnRQdWJsaWNBY2Nlc3MgPT09ICd0cnVlJztcbiAgfVxuXG4gIHJldHVybiBwYXJzZWQ7XG5cbn1cblxuaW50ZXJmYWNlIFVwZGF0ZU1hcCB7XG4gIHJlcGxhY2VOYW1lOiBib29sZWFuOyAvLyBuYW1lXG4gIHJlcGxhY2VWcGM6IGJvb2xlYW47IC8vIHJlc291cmNlc1ZwY0NvbmZpZy5zdWJuZXRJZHMgYW5kIHNlY3VyaXR5R3JvdXBJZHNcbiAgcmVwbGFjZVJvbGU6IGJvb2xlYW47IC8vIHJvbGVBcm5cblxuICB1cGRhdGVWZXJzaW9uOiBib29sZWFuOyAvLyB2ZXJzaW9uXG4gIHVwZGF0ZUxvZ2dpbmc6IGJvb2xlYW47IC8vIGxvZ2dpbmdcbiAgdXBkYXRlRW5jcnlwdGlvbjogYm9vbGVhbjsgLy8gZW5jcnlwdGlvbiAoY2Fubm90IGJlIHVwZGF0ZWQpXG4gIHVwZGF0ZUFjY2VzczogYm9vbGVhbjsgLy8gcmVzb3VyY2VzVnBjQ29uZmlnLmVuZHBvaW50UHJpdmF0ZUFjY2VzcyBhbmQgZW5kcG9pbnRQdWJsaWNBY2Nlc3Ncbn1cblxuZnVuY3Rpb24gYW5hbHl6ZVVwZGF0ZShvbGRQcm9wczogUGFydGlhbDxhd3MuRUtTLkNyZWF0ZUNsdXN0ZXJSZXF1ZXN0PiwgbmV3UHJvcHM6IGF3cy5FS1MuQ3JlYXRlQ2x1c3RlclJlcXVlc3QpOiBVcGRhdGVNYXAge1xuICBjb25zb2xlLmxvZygnb2xkIHByb3BzOiAnLCBKU09OLnN0cmluZ2lmeShvbGRQcm9wcykpO1xuICBjb25zb2xlLmxvZygnbmV3IHByb3BzOiAnLCBKU09OLnN0cmluZ2lmeShuZXdQcm9wcykpO1xuXG4gIGNvbnN0IG5ld1ZwY1Byb3BzID0gbmV3UHJvcHMucmVzb3VyY2VzVnBjQ29uZmlnIHx8IHt9O1xuICBjb25zdCBvbGRWcGNQcm9wcyA9IG9sZFByb3BzLnJlc291cmNlc1ZwY0NvbmZpZyB8fCB7fTtcblxuICBjb25zdCBvbGRQdWJsaWNBY2Nlc3NDaWRycyA9IG5ldyBTZXQob2xkVnBjUHJvcHMucHVibGljQWNjZXNzQ2lkcnMgPz8gW10pO1xuICBjb25zdCBuZXdQdWJsaWNBY2Nlc3NDaWRycyA9IG5ldyBTZXQobmV3VnBjUHJvcHMucHVibGljQWNjZXNzQ2lkcnMgPz8gW10pO1xuICBjb25zdCBuZXdFbmMgPSBuZXdQcm9wcy5lbmNyeXB0aW9uQ29uZmlnIHx8IHt9O1xuICBjb25zdCBvbGRFbmMgPSBvbGRQcm9wcy5lbmNyeXB0aW9uQ29uZmlnIHx8IHt9O1xuXG4gIHJldHVybiB7XG4gICAgcmVwbGFjZU5hbWU6IG5ld1Byb3BzLm5hbWUgIT09IG9sZFByb3BzLm5hbWUsXG4gICAgcmVwbGFjZVZwYzpcbiAgICAgIEpTT04uc3RyaW5naWZ5KG5ld1ZwY1Byb3BzLnN1Ym5ldElkcykgIT09IEpTT04uc3RyaW5naWZ5KG9sZFZwY1Byb3BzLnN1Ym5ldElkcykgfHxcbiAgICAgIEpTT04uc3RyaW5naWZ5KG5ld1ZwY1Byb3BzLnNlY3VyaXR5R3JvdXBJZHMpICE9PSBKU09OLnN0cmluZ2lmeShvbGRWcGNQcm9wcy5zZWN1cml0eUdyb3VwSWRzKSxcbiAgICB1cGRhdGVBY2Nlc3M6XG4gICAgICBuZXdWcGNQcm9wcy5lbmRwb2ludFByaXZhdGVBY2Nlc3MgIT09IG9sZFZwY1Byb3BzLmVuZHBvaW50UHJpdmF0ZUFjY2VzcyB8fFxuICAgICAgbmV3VnBjUHJvcHMuZW5kcG9pbnRQdWJsaWNBY2Nlc3MgIT09IG9sZFZwY1Byb3BzLmVuZHBvaW50UHVibGljQWNjZXNzIHx8XG4gICAgICAhc2V0c0VxdWFsKG5ld1B1YmxpY0FjY2Vzc0NpZHJzLCBvbGRQdWJsaWNBY2Nlc3NDaWRycyksXG4gICAgcmVwbGFjZVJvbGU6IG5ld1Byb3BzLnJvbGVBcm4gIT09IG9sZFByb3BzLnJvbGVBcm4sXG4gICAgdXBkYXRlVmVyc2lvbjogbmV3UHJvcHMudmVyc2lvbiAhPT0gb2xkUHJvcHMudmVyc2lvbixcbiAgICB1cGRhdGVFbmNyeXB0aW9uOiBKU09OLnN0cmluZ2lmeShuZXdFbmMpICE9PSBKU09OLnN0cmluZ2lmeShvbGRFbmMpLFxuICAgIHVwZGF0ZUxvZ2dpbmc6IEpTT04uc3RyaW5naWZ5KG5ld1Byb3BzLmxvZ2dpbmcpICE9PSBKU09OLnN0cmluZ2lmeShvbGRQcm9wcy5sb2dnaW5nKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gc2V0c0VxdWFsKGZpcnN0OiBTZXQ8c3RyaW5nPiwgc2Vjb25kOiBTZXQ8c3RyaW5nPikge1xuICByZXR1cm4gZmlyc3Quc2l6ZSA9PT0gc2Vjb25kLnNpemUgfHwgWy4uLmZpcnN0XS5ldmVyeSgoZTogc3RyaW5nKSA9PiBzZWNvbmQuaGFzKGUpKTtcbn1cbiJdfQ==