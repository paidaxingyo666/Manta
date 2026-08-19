import { ClaudeIcon, OpenAIIcon } from '../../status-bar/icons'
import { cn } from '../../../lib/utils'
import { translate } from '@/i18n/i18n'

export function HomeSlide({ tapping }: { tapping: boolean }): React.JSX.Element {
  return (
    <div className="mp-device-screen">
      <div className="mp-app-topbar">
        <div className="mp-app-brand">
          <MantaLogo />
          <span className="mp-app-brand-name">
            {translate('auto.components.mobile.slides.HomeSlide.5d94e8ddcc', 'Manta')}
          </span>
        </div>
        <button
          type="button"
          className="mp-icon-button"
          aria-label={translate('auto.components.mobile.slides.HomeSlide.af761a0c0d', 'Settings')}
        >
          <SettingsIcon />
        </button>
      </div>

      <div className="mp-scroll-region">
        <div className="mp-greeting">
          <div className="mp-greeting-title">
            {translate('auto.components.mobile.slides.HomeSlide.c0e2e9dcd9', 'Welcome back')}
          </div>
        </div>

        <div className="mp-stat-row">
          <Stat
            value="1,284"
            label={translate(
              'auto.components.mobile.slides.HomeSlide.00a6903322',
              'Agents spawned'
            )}
          />
          <Stat
            value="142h"
            label={translate('auto.components.mobile.slides.HomeSlide.4a40af029b', 'Agent time')}
          />
          <Stat
            value="96"
            label={translate('auto.components.mobile.slides.HomeSlide.156db8a68a', 'PRs created')}
          />
        </div>

        <div className="mp-section-label">
          {translate('auto.components.mobile.slides.HomeSlide.2f1a1d10c4', 'Desktops')}
        </div>
        <div className={cn('mp-host-card', tapping && 'is-tapping')}>
          <div className="mp-host-icon">
            <DesktopIcon />
          </div>
          <div className="mp-host-main">
            <div className="mp-host-name">
              {translate('auto.components.mobile.slides.HomeSlide.19c212e25e', 'MacBook Pro')}
            </div>
            <div className="mp-host-meta">
              <span className="mp-status-dot is-green" />
              <span>
                {translate(
                  'auto.components.mobile.slides.HomeSlide.0bc1881bc4',
                  'Connected · 40 worktrees · 5 active'
                )}
              </span>
            </div>
          </div>
          <div className="mp-chevron-right">
            <ChevronIcon />
          </div>
        </div>
        <div className="mp-host-card">
          <div className="mp-host-icon is-dim">
            <DesktopIcon />
          </div>
          <div className="mp-host-main">
            <div className="mp-host-name is-dim">
              {translate('auto.components.mobile.slides.HomeSlide.091355da3d', 'M1 Mini · home')}
            </div>
            <div className="mp-host-meta">
              <span className="mp-status-dot is-muted" />
              <span>
                {translate('auto.components.mobile.slides.HomeSlide.cf3f98fa3f', 'Disconnected')}
              </span>
            </div>
          </div>
          <div className="mp-chevron-right">
            <ChevronIcon />
          </div>
        </div>

        <div className="mp-section-label" style={{ marginTop: 14 }}>
          {translate('auto.components.mobile.slides.HomeSlide.c791677f2f', 'Resume')}
        </div>
        <div className="mp-resume-card">
          <div className="mp-resume-icon">
            <ResumeIcon />
          </div>
          <div className="mp-host-main">
            <div className="mp-resume-title">
              {translate('auto.components.mobile.slides.HomeSlide.25d6e8a491', 'feat/mobile-page')}
            </div>
            <div className="mp-resume-sub">
              <span className="mp-repo-dot" style={{ background: '#3b82f6' }} />
              <span>
                {translate(
                  'auto.components.mobile.slides.HomeSlide.d33d7a9c29',
                  // Why: plain spaces (not &nbsp;) — React text nodes render HTML entities literally.
                  'manta  ·  feat/mobile-page'
                )}
              </span>
            </div>
          </div>
          <div className="mp-chevron-right">
            <ChevronIcon />
          </div>
        </div>

        <div className="mp-section-label" style={{ marginTop: 10 }}>
          {translate('auto.components.mobile.slides.HomeSlide.a4c3f7b7aa', 'Tasks')}
        </div>
        <div className="mp-task-home-card">
          <div className="mp-task-home-icon">
            <ListTodoIcon />
          </div>
          <div className="mp-host-main">
            <div className="mp-task-home-title">
              {translate('auto.components.mobile.slides.HomeSlide.a4c3f7b7aa', 'Tasks')}
            </div>
            <div className="mp-task-home-subtitle">
              {translate('auto.components.mobile.slides.HomeSlide.d047197480', 'GitHub · Linear')}
            </div>
          </div>
          <div
            className="mp-task-home-providers"
            aria-label={translate(
              'auto.components.mobile.slides.HomeSlide.0bad5b07c8',
              'GitHub and Linear'
            )}
          >
            <div className="mp-task-home-provider-button">
              <GithubIcon />
            </div>
            <div className="mp-task-home-provider-button">
              <LinearIcon />
            </div>
          </div>
          <div className="mp-chevron-right">
            <ChevronIcon />
          </div>
        </div>

        <div className="mp-section-label" style={{ marginTop: 14 }}>
          {translate('auto.components.mobile.slides.HomeSlide.0b00c98506', 'Quick Actions')}
        </div>
        <div className="mp-quick-actions">
          <div className="mp-quick-action">
            <div className="mp-quick-action-icon">
              <QrSmallIcon />
            </div>
            <div className="mp-quick-action-label">
              {translate('auto.components.mobile.slides.HomeSlide.4405f3c440', 'Pair Desktop')}
            </div>
          </div>
          <div className="mp-quick-action">
            <div className="mp-quick-action-icon">
              <PlusIcon />
            </div>
            <div className="mp-quick-action-label">
              {translate('auto.components.mobile.slides.HomeSlide.e27fdaee51', 'New Workspace')}
            </div>
          </div>
        </div>

        <div className="mp-section-label" style={{ marginTop: 14 }}>
          {translate('auto.components.mobile.slides.HomeSlide.8a350a4784', 'Account usage')}
        </div>
        <div className="mp-accounts-card">
          <AccountRow
            icon={<ClaudeIcon size={18} />}
            email="claude@stably.ai"
            sessionPct={42}
            weekPct={18}
          />
          <AccountRow
            icon={<OpenAIIcon size={18} />}
            email="codex@stably.ai"
            sessionPct={67}
            weekPct={31}
          />
        </div>
      </div>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div className="mp-stat-card">
      <div className="mp-stat-value">{value}</div>
      <div className="mp-stat-label">{label}</div>
    </div>
  )
}

function AccountRow({
  icon,
  email,
  sessionPct,
  weekPct
}: {
  icon: React.ReactNode
  email: string
  sessionPct: number
  weekPct: number
}): React.JSX.Element {
  return (
    <div className="mp-accounts-row">
      <div className="mp-accounts-icon">{icon}</div>
      <div className="mp-accounts-info">
        <div className="mp-accounts-email">{email}</div>
        <div className="mp-accounts-bars">
          <UsageBar
            label={translate('auto.components.mobile.slides.HomeSlide.a3d5476811', '5h')}
            pct={sessionPct}
          />
          <UsageBar
            label={translate('auto.components.mobile.slides.HomeSlide.a7d9e2c44d', '7d')}
            pct={weekPct}
          />
        </div>
      </div>
    </div>
  )
}

function UsageBar({ label, pct }: { label: string; pct: number }): React.JSX.Element {
  return (
    <div className="mp-usage-bar">
      <div className="mp-usage-bar-label">{label}</div>
      <div className="mp-usage-bar-track">
        <div className="mp-usage-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function MantaLogo(): React.JSX.Element {
  return (
    <svg
      className="mp-manta-logo"
      viewBox="0 0 318.60232 202.66667"
      fill="currentColor"
      aria-hidden
    >
      <g>
        <path d="M 137.47,2.03 C 135.74,2.03 133.2,4.97 131.59,6.87 C 129.99,8.76 129,11.19 127.83,13.4 C 126.66,15.61 125.86,17.97 124.56,20.13 C 123.27,22.29 121.74,24.39 120.07,26.35 C 118.39,28.32 116.42,30.17 114.49,31.93 C 112.56,33.69 110.54,35.41 108.47,36.91 C 106.4,38.41 104.23,39.69 102.04,40.92 C 99.85,42.14 97.6,43.2 95.34,44.25 C 93.08,45.3 90.79,46.3 88.48,47.21 C 86.16,48.13 83.84,49.03 81.44,49.75 C 79.05,50.47 76.55,50.95 74.1,51.55 C 71.66,52.15 69.22,52.78 66.76,53.35 C 64.3,53.92 61.81,54.42 59.35,54.98 C 56.89,55.54 54.41,56.07 51.98,56.71 C 49.55,57.34 47.14,58.03 44.75,58.78 C 42.37,59.53 39.98,60.28 37.67,61.21 C 35.36,62.13 33.1,63.18 30.88,64.32 C 28.65,65.47 26.45,66.67 24.35,68.08 C 22.24,69.5 20.21,71.12 18.22,72.82 C 16.23,74.52 14.1,76.34 12.4,78.3 C 10.71,80.25 8.99,82.39 8.04,84.57 C 7.09,86.75 5.77,90.25 6.71,91.37 C 7.64,92.49 11.3,91.67 13.67,91.32 C 16.03,90.96 18.44,89.82 20.89,89.24 C 23.35,88.66 25.83,88.14 28.41,87.86 C 30.98,87.57 33.7,87.51 36.35,87.51 C 39,87.51 41.69,87.62 44.29,87.86 C 46.89,88.09 49.42,88.49 51.95,88.89 C 54.48,89.3 57.01,89.7 59.46,90.28 C 61.92,90.85 64.3,91.6 66.69,92.35 C 69.07,93.1 71.45,93.87 73.77,94.78 C 76.09,95.68 78.35,96.75 80.61,97.79 C 82.88,98.83 85.14,99.88 87.36,101.01 C 89.59,102.14 91.8,103.31 93.97,104.58 C 96.14,105.84 98.27,107.2 100.38,108.62 C 102.49,110.04 104.58,111.5 106.62,113.07 C 108.67,114.65 110.66,116.36 112.65,118.06 C 114.64,119.76 116.63,121.46 118.57,123.29 C 120.51,125.11 122.46,127.07 124.29,129 C 126.11,130.94 127.81,132.93 129.51,134.93 C 131.22,136.92 132.88,138.92 134.5,140.95 C 136.12,142.97 137.51,145.13 139.24,147.07 C 140.96,149.01 142.82,151.02 144.84,152.57 C 146.86,154.12 149.75,154.78 151.35,156.38 C 152.95,157.98 153.8,159.93 154.43,162.2 C 155.06,164.47 154.95,167.37 155.12,170 C 155.29,172.62 155.47,175.29 155.47,177.94 C 155.47,180.59 155.2,183.22 155.12,185.88 C 155.04,188.55 155.02,191.45 154.97,193.91 C 154.92,196.37 154.38,200.68 154.81,200.64 C 155.24,200.6 156.78,196.06 157.54,193.68 C 158.31,191.31 158.82,188.82 159.4,186.37 C 159.97,183.91 160.51,181.43 161,178.95 C 161.5,176.46 161.93,173.94 162.39,171.43 C 162.85,168.93 163.22,166.37 163.77,163.92 C 164.32,161.47 164.23,158.44 165.68,156.73 C 167.13,155.01 170.36,155.01 172.47,153.61 C 174.59,152.21 176.57,150.23 178.38,148.35 C 180.2,146.47 181.74,144.35 183.36,142.32 C 184.99,140.3 186.44,138.21 188.1,136.2 C 189.76,134.19 191.51,132.22 193.33,130.28 C 195.16,128.34 197.13,126.43 199.05,124.56 C 200.97,122.7 202.89,120.82 204.87,119.09 C 206.85,117.36 208.87,115.74 210.91,114.16 C 212.95,112.58 215.02,111.05 217.12,109.61 C 219.21,108.17 221.34,106.8 223.5,105.51 C 225.66,104.21 227.86,103 230.07,101.85 C 232.29,100.69 234.55,99.64 236.8,98.58 C 239.06,97.51 241.29,96.39 243.6,95.47 C 245.92,94.55 248.3,93.8 250.69,93.05 C 253.07,92.3 255.48,91.6 257.91,90.97 C 260.35,90.34 262.8,89.76 265.28,89.24 C 267.76,88.72 270.22,88.14 272.8,87.86 C 275.37,87.57 278.07,87.57 280.74,87.51 C 283.41,87.45 286.22,87.28 288.82,87.51 C 291.42,87.74 293.86,88.36 296.34,88.89 C 298.81,89.43 301.24,90.08 303.67,90.71 C 306.1,91.33 309.54,93.36 310.91,92.65 C 312.28,91.94 312.37,88.56 311.9,86.44 C 311.43,84.32 309.63,81.98 308.09,79.93 C 306.55,77.87 304.55,75.9 302.64,74.1 C 300.73,72.3 298.69,70.61 296.62,69.12 C 294.54,67.62 292.39,66.31 290.19,65.11 C 287.99,63.91 285.73,62.87 283.43,61.9 C 281.14,60.93 278.78,60.11 276.42,59.3 C 274.06,58.5 271.69,57.72 269.27,57.05 C 266.85,56.39 264.38,55.85 261.9,55.32 C 259.42,54.8 256.88,54.41 254.4,53.9 C 251.92,53.38 249.45,52.84 247.02,52.21 C 244.58,51.58 242.17,50.88 239.79,50.13 C 237.4,49.38 235.04,48.57 232.71,47.71 C 230.37,46.84 228.03,45.98 225.77,44.94 C 223.5,43.9 221.31,42.69 219.11,41.48 C 216.92,40.27 214.69,39.13 212.6,37.67 C 210.51,36.21 208.51,34.47 206.57,32.71 C 204.64,30.96 202.68,29.11 201,27.14 C 199.32,25.17 197.8,23.07 196.5,20.91 C 195.2,18.76 194.32,16.43 193.19,14.2 C 192.06,11.97 191.25,9.52 189.72,7.55 C 188.18,5.58 185.77,2.6 183.98,2.37 C 182.19,2.15 179.66,4.29 179,6.21 C 178.34,8.12 180.62,11.62 180.04,13.86 C 179.46,16.11 177.44,18.25 175.54,19.68 C 173.63,21.11 171.05,21.87 168.6,22.45 C 166.14,23.02 163.4,23.14 160.8,23.14 C 158.2,23.14 155.48,22.96 153,22.45 C 150.52,21.93 147.92,21.35 145.91,20.02 C 143.9,18.7 141.59,16.69 140.93,14.49 C 140.27,12.29 142.55,8.91 141.97,6.83 C 141.39,4.75 139.2,2.02 137.47,2.03 Z" />
      </g>
    </svg>
  )
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}

function DesktopIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  )
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function ResumeIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </svg>
  )
}

function ListTodoIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  )
}

function GithubIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  )
}

function LinearIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden>
      <path d="M1.225 61.523c-.187-.738.708-1.235 1.246-.697l36.703 36.703c.538.538.041 1.433-.697 1.246C20.6 94.16 5.84 79.4 1.225 61.523ZM.002 46.811a.997.997 0 0 0 .291.749l52.147 52.147a.998.998 0 0 0 .749.291 50.328 50.328 0 0 0 9.235-1.119c.667-.149.904-.972.422-1.454L1.575 37.154c-.482-.482-1.305-.245-1.454.422A50.328 50.328 0 0 0 .002 46.81Zm4.528-18.34a.998.998 0 0 0 .195 1.144l64.66 64.66a.998.998 0 0 0 1.144.195 50.45 50.45 0 0 0 5.913-3.46.999.999 0 0 0 .14-1.518L9.51 22.418a.999.999 0 0 0-1.518.14 50.45 50.45 0 0 0-3.46 5.913Zm10.435-13.075a.999.999 0 0 0 .002 1.41l68.226 68.226a.999.999 0 0 0 1.41.002c19.292-19.477 19.234-50.97-.176-70.378-19.410-19.410-50.901-19.468-70.378-.176-1.061 1.044.916 1.916.916 1.916Z" />
    </svg>
  )
}

function QrSmallIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="3" height="3" />
      <rect x="18" y="14" width="3" height="3" />
      <rect x="14" y="18" width="3" height="3" />
      <rect x="18" y="18" width="3" height="3" />
    </svg>
  )
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  )
}
