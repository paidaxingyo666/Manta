import { describe, expect, it } from 'vitest'

import {
  effectiveGitHubRemoteHost,
  gitHubSshConfigHostAlias,
  parseGitHubOwnerRepo,
  parseGitHubOwnerRepoWithResolvedSshHostname,
  parseGitHubRemoteIdentity,
  remoteUrlUsesSshTransport
} from './github-remote-identity-parsing'

describe('parseGitHubRemoteIdentity', () => {
  it('parses a plain github.com https remote', () => {
    expect(parseGitHubRemoteIdentity('https://github.com/team/manta.git')).toEqual({
      host: 'github.com',
      owner: 'team',
      repo: 'manta'
    })
  })

  it('parses an SCP-style github.com remote', () => {
    expect(parseGitHubRemoteIdentity('git@github.com:team/manta.git')).toEqual({
      host: 'github.com',
      owner: 'team',
      repo: 'manta'
    })
  })

  it('preserves a custom port on a GHES https remote', () => {
    // The port IS the Enterprise web/API endpoint, so gh must target
    // ghe.acme.com:8443, not the portless hostname.
    expect(parseGitHubRemoteIdentity('https://ghe.acme.com:8443/team/manta.git')).toEqual({
      host: 'ghe.acme.com:8443',
      owner: 'team',
      repo: 'manta'
    })
  })

  it('preserves a custom port on a GHES http remote', () => {
    expect(parseGitHubRemoteIdentity('http://ghe.acme.com:8080/team/manta.git')).toEqual({
      host: 'ghe.acme.com:8080',
      owner: 'team',
      repo: 'manta'
    })
  })

  it('drops the default https port so github.com stays bare', () => {
    // WHATWG URL omits default ports, so :443 never leaks into the host.
    expect(parseGitHubRemoteIdentity('https://github.com:443/team/manta.git')?.host).toBe(
      'github.com'
    )
  })

  it('drops the default https port on a GHES host', () => {
    expect(parseGitHubRemoteIdentity('https://ghe.acme.com:443/team/manta.git')?.host).toBe(
      'ghe.acme.com'
    )
  })

  it('normalizes ssh.github.com:443 (SSH-over-HTTPS) to github.com without a port', () => {
    // :443 here is the ssh transport port, not an endpoint — it must not survive.
    expect(parseGitHubRemoteIdentity('ssh://git@ssh.github.com:443/team/manta.git')).toEqual({
      host: 'github.com',
      owner: 'team',
      repo: 'manta'
    })
  })

  it('drops a custom ssh transport port on a GHES ssh remote', () => {
    // ssh://…:2222 is a transport port; gh routes by hostname, so keep only the host.
    expect(parseGitHubRemoteIdentity('ssh://git@ghe.acme.com:2222/team/manta.git')?.host).toBe(
      'ghe.acme.com'
    )
  })

  it('drops the transport port for git+ssh and git remotes', () => {
    expect(parseGitHubRemoteIdentity('git+ssh://git@ghe.acme.com:2222/team/manta.git')?.host).toBe(
      'ghe.acme.com'
    )
    expect(parseGitHubRemoteIdentity('git://ghe.acme.com:9418/team/manta.git')?.host).toBe(
      'ghe.acme.com'
    )
  })

  it('lowercases the host while keeping the port', () => {
    expect(parseGitHubRemoteIdentity('https://GHE.Acme.COM:8443/team/manta.git')?.host).toBe(
      'ghe.acme.com:8443'
    )
  })

  it('returns null for an unparseable remote', () => {
    expect(parseGitHubRemoteIdentity('not-a-remote')).toBeNull()
  })
})

describe('parseGitHubOwnerRepo', () => {
  it('returns owner/repo for github.com', () => {
    expect(parseGitHubOwnerRepo('https://github.com/team/manta.git')).toEqual({
      owner: 'team',
      repo: 'manta'
    })
  })

  it('returns null for a custom-port GHES remote (not github.com)', () => {
    // GHES is handled by the enterprise resolver, not the github.com fast path,
    // and the port must not make a github.com remote look like GHES either.
    expect(parseGitHubOwnerRepo('https://ghe.acme.com:8443/team/manta.git')).toBeNull()
  })

  it('still recognizes github.com even with an explicit default port', () => {
    expect(parseGitHubOwnerRepo('https://github.com:443/team/manta.git')).toEqual({
      owner: 'team',
      repo: 'manta'
    })
  })

  it('returns null for an SSH Host alias remote without HostName resolution', () => {
    expect(parseGitHubOwnerRepo('git@github-work:team/manta.git')).toBeNull()
    expect(parseGitHubOwnerRepo('git@github.com-work:team/manta.git')).toBeNull()
    expect(parseGitHubOwnerRepo('ssh://git@github-work/team/manta.git')).toBeNull()
  })
})

describe('SSH Host alias identity (#10284)', () => {
  it('detects SCP and ssh:// remotes as SSH transport', () => {
    expect(remoteUrlUsesSshTransport('git@github-work:team/manta.git')).toBe(true)
    expect(remoteUrlUsesSshTransport('ssh://git@github-work/team/manta.git')).toBe(true)
    expect(remoteUrlUsesSshTransport('git+ssh://git@github-work/team/manta.git')).toBe(true)
    expect(remoteUrlUsesSshTransport('https://github.com/team/manta.git')).toBe(false)
  })

  it('exposes Host aliases that need ssh -G expansion', () => {
    expect(gitHubSshConfigHostAlias('git@github-work:team/manta.git')).toBe('github-work')
    expect(gitHubSshConfigHostAlias('git@github.com-work:team/manta.git')).toBe('github.com-work')
    expect(gitHubSshConfigHostAlias('ssh://git@github-work/team/manta.git')).toBe('github-work')
    expect(gitHubSshConfigHostAlias('git@github.com:team/manta.git')).toBeNull()
    expect(gitHubSshConfigHostAlias('https://github.com/team/manta.git')).toBeNull()
  })

  it('preserves SSH Host alias case for OpenSSH Host matching', () => {
    expect(gitHubSshConfigHostAlias('git@GitHub-Work:team/manta.git')).toBe('GitHub-Work')
    expect(gitHubSshConfigHostAlias('ssh://git@GitHub-Work/team/manta.git')).toBe('GitHub-Work')
    expect(gitHubSshConfigHostAlias('git+ssh://git@GitHub-Work/team/manta.git')).toBe('GitHub-Work')
  })

  it('returns owner/repo when resolved HostName is github.com', () => {
    expect(
      parseGitHubOwnerRepoWithResolvedSshHostname('git@github-work:team/manta.git', 'github.com')
    ).toEqual({ owner: 'team', repo: 'manta' })
  })

  it('returns owner/repo when resolved HostName is ssh.github.com (SSH-over-HTTPS)', () => {
    expect(
      parseGitHubOwnerRepoWithResolvedSshHostname(
        'git@github-work:team/manta.git',
        'ssh.github.com'
      )
    ).toEqual({ owner: 'team', repo: 'manta' })
  })

  it('keeps owner/repo for literal github.com even if resolved host is unused', () => {
    expect(
      parseGitHubOwnerRepoWithResolvedSshHostname('git@github.com:team/manta.git', null)
    ).toEqual({ owner: 'team', repo: 'manta' })
  })

  it('returns null when resolved HostName is a non-GitHub forge', () => {
    expect(
      parseGitHubOwnerRepoWithResolvedSshHostname('git@gitlab-work:team/manta.git', 'gitlab.com')
    ).toBeNull()
  })

  it('does not apply SSH HostName resolution to HTTPS remotes', () => {
    expect(
      parseGitHubOwnerRepoWithResolvedSshHostname(
        'https://github-work/team/manta.git',
        'github.com'
      )
    ).toBeNull()
  })

  it('returns null when SSH resolution is missing', () => {
    expect(
      parseGitHubOwnerRepoWithResolvedSshHostname('git@github-work:team/manta.git', null)
    ).toBeNull()
    expect(
      parseGitHubOwnerRepoWithResolvedSshHostname('git@github-work:team/manta.git', '   ')
    ).toBeNull()
  })

  it('normalizes effective host for enterprise routing after HostName expansion', () => {
    expect(effectiveGitHubRemoteHost('github-work', 'ssh.github.com')).toBe('github.com')
    expect(effectiveGitHubRemoteHost('ghe-work', 'ghe.acme.com')).toBe('ghe.acme.com')
    expect(effectiveGitHubRemoteHost('github.com', null)).toBe('github.com')
  })
})
