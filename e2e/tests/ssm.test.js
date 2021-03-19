/* eslint-env mocha */
'use strict'

const util = require('util')
const { expect } = require('chai')

const {
  kubeClient,
  customResourceManifest,
  awsConfig,
  backends
} = require('../../config')
const { waitForSecret, uuid } = require('./framework.js')

const ssm = awsConfig.systemManagerFactory()
const putParameter = util.promisify(ssm.putParameter).bind(ssm)

describe('ssm', async () => {
  it('should pull existing secret from ssm and create a secret from it', async () => {
    let result = await putParameter({
      Name: `/e2e/${uuid}/name`,
      Type: 'String',
      Value: 'foo'
    }).catch(err => {
      expect(err).to.equal(null)
    })

    result = await kubeClient
      .apis[customResourceManifest.spec.group]
      .v1.namespaces('default')[customResourceManifest.spec.names.plural]
      .post({
        body: {
          apiVersion: 'kubernetes-client.io/v1',
          kind: 'ExternalSecret',
          metadata: {
            name: `e2e-ssm-${uuid}`
          },
          spec: {
            backendType: 'systemManager',
            data: [
              {
                key: `/e2e/${uuid}/name`,
                name: 'name'
              }
            ]
          }
        }
      })

    expect(result).to.not.equal(undefined)
    expect(result.statusCode).to.equal(201)

    const secret = await waitForSecret('default', `e2e-ssm-${uuid}`)
    expect(secret.body.data.name).to.equal('Zm9v')
  })

  it('should pull existing secrets from ssm path and create a secret from it', async () => {
    const name1 = await putParameter({
      Name: `/e2e/${uuid}-names/name1`,
      Type: 'String',
      Value: 'foo'
    }).catch(err => {
      expect(err).to.equal(null)
    })

    const name2 = await putParameter({
      Name: `/e2e/${uuid}-names/name2`,
      Type: 'String',
      Value: 'bar'
    }).catch(err => {
      expect(err).to.equal(null)
    })

    const result = await kubeClient
      .apis[customResourceManifest.spec.group]
      .v1.namespaces('default')[customResourceManifest.spec.names.plural]
      .post({
        body: {
          apiVersion: 'kubernetes-client.io/v1',
          kind: 'ExternalSecret',
          metadata: {
            name: `e2e-ssm-${uuid}-names`
          },
          spec: {
            backendType: 'systemManager',
            data: [
              {
                path: `/e2e/${uuid}-names`
              }
            ]
          }
        }
      })

    expect(name1).to.not.equal(undefined)
    expect(name2).to.not.equal(undefined)
    expect(result).to.not.equal(undefined)
    expect(result.statusCode).to.equal(201)

    const secret = await waitForSecret('default', `e2e-ssm-${uuid}-names`)
    expect(secret.body.data.name1).to.equal('Zm9v') // Expect base64 foo
    expect(secret.body.data.name2).to.equal('YmFy') // Expect base64 bar
  })

  it('should pull existing secret from ssm in a different region', async () => {
    const ssmEU = awsConfig.systemManagerFactory({
      region: 'eu-west-1'
    })
    const putParameter = util.promisify(ssmEU.putParameter).bind(ssmEU)

    let result = await putParameter({
      Name: `/e2e/${uuid}/x-region`,
      Type: 'String',
      Value: 'foo'
    }).catch(err => {
      expect(err).to.equal(null)
    })

    result = await kubeClient
      .apis[customResourceManifest.spec.group]
      .v1.namespaces('default')[customResourceManifest.spec.names.plural]
      .post({
        body: {
          apiVersion: 'kubernetes-client.io/v1',
          kind: 'ExternalSecret',
          metadata: {
            name: `e2e-ssm-xregion-${uuid}`
          },
          spec: {
            backendType: 'systemManager',
            region: 'eu-west-1',
            data: [
              {
                key: `/e2e/${uuid}/x-region`,
                name: 'name'
              }
            ]
          }
        }
      })

    expect(result).to.not.equal(undefined)
    expect(result.statusCode).to.equal(201)

    const secret = await waitForSecret('default', `e2e-ssm-xregion-${uuid}`)
    expect(secret.body.data.name).to.equal('Zm9v')
  })

  describe('permitted annotation', async () => {
    beforeEach(async () => {
      await kubeClient.api.v1.namespaces('default').patch({
        body: {
          metadata: {
            annotations: {
              'iam.amazonaws.com/permitted': '^(foo|bar)'
            }
          }
        }
      })
    })

    afterEach(async () => {
      await kubeClient.api.v1.namespaces('default').patch({
        body: {
          metadata: {
            annotations: {
              'iam.amazonaws.com/permitted': '.*'
            }
          }
        }
      })
    })

    it('should not pull from ssm', async () => {
      let result = await putParameter({
        Name: `/e2e/permitted/${uuid}`,
        Type: 'String',
        Value: 'foo'
      }).catch(err => {
        expect(err).to.equal(null)
      })

      result = await kubeClient
        .apis[customResourceManifest.spec.group]
        .v1.namespaces('default')[customResourceManifest.spec.names.plural]
        .post({
          body: {
            apiVersion: 'kubernetes-client.io/v1',
            kind: 'ExternalSecret',
            metadata: {
              name: `e2e-ssm-permitted-${uuid}`
            },
            spec: {
              backendType: 'systemManager',
              roleArn: 'let-me-be-root',
              data: [
                {
                  key: `/e2e/permitted/${uuid}`,
                  name: 'name'
                }
              ]
            }
          }
        })

      expect(result).to.not.equal(undefined)
      expect(result.statusCode).to.equal(201)

      const secret = await waitForSecret('default', `e2e-ssm-permitted-${uuid}`)
      expect(secret).to.equal(undefined)

      result = await kubeClient
        .apis[customResourceManifest.spec.group]
        .v1.namespaces('default')
        .externalsecrets(`e2e-ssm-permitted-${uuid}`)
        .get()
      expect(result).to.not.equal(undefined)
      expect(result.body.status.status).to.contain('namespace does not allow to assume role let-me-be-root')
    })
    it('should not pull from ssm after waiting POLLER_INTERVAL_MILLISECONDS', async () => {
      backends.systemManager.checkUpdated = true

      backends.systemManager.intervalPolling = 1000

      let result = await putParameter({
        Name: `/e2e/ssmcheck/${uuid}`,
        Type: 'String',
        Value: 'foo'
      }).catch(err => {
        expect(err).to.equal(null)
      })

      result = await kubeClient
        .apis[customResourceManifest.spec.group]
        .v1.namespaces('default')[customResourceManifest.spec.names.plural]
        .post({
          body: {
            apiVersion: 'kubernetes-client.io/v1',
            kind: 'ExternalSecret',
            metadata: {
              name: `e2e-ssm-ssmcheck-${uuid}`
            },
            spec: {
              backendType: 'systemManager',
              data: [
                {
                  key: `/e2e/ssmcheck/${uuid}`,
                  name: 'name'
                }
              ]
            }
          }
        })

      await new Promise(resolve => setTimeout(resolve, 5000))

      expect(result).to.not.equal(undefined)
      expect(result.statusCode).to.equal(201)

      result = await kubeClient
        .apis[customResourceManifest.spec.group]
        .v1.namespaces('default')
        .externalsecrets(`e2e-ssm-ssmcheck-${uuid}`)
        .get()
      expect(result).to.not.equal(undefined)
      expect(result.body.status.status).to.contain('The parameter has not changed since last time')
    })
    it('should pull from ssm with 500 history of parameters', async () => {
      backends.systemManager.checkUpdated = true

      for (let i = 1; i <= 500; i++) {
        await putParameter({
          Name: `/e2e/ssmcheck/${uuid}`,
          Type: 'String',
          Value: `foo${i}`,
          Overwrite: true
        }).catch(err => {
          expect(err).to.equal(null)
        })
      }
      const result = await kubeClient
        .apis[customResourceManifest.spec.group]
        .v1.namespaces('default')[customResourceManifest.spec.names.plural]
        .post({
          body: {
            apiVersion: 'kubernetes-client.io/v1',
            kind: 'ExternalSecret',
            metadata: {
              name: `e2e-ssmcheck-${uuid}`
            },
            spec: {
              backendType: 'systemManager',
              data: [
                {
                  key: `/e2e/ssmcheck/${uuid}`,
                  name: 'name'
                }
              ]
            }
          }
        })

      expect(result).to.not.equal(undefined)
      expect(result.statusCode).to.equal(201)

      const secret = await waitForSecret('default', `e2e-ssmcheck-${uuid}`)
      expect(secret).to.not.equal(undefined)
      expect(secret.body.data.name).to.equal('Zm9vNTAw') // Expect base64 foo500
    })
  })
})
