/**
 * The System page, laid out as the original Studio's: the machine, the
 * runtime (Node.js here), the lyteboat build and where it keeps its data, the
 * process's properties, and the environment variables with their secrets
 * masked by the server, filterable by name.
 * @module @lyteboat/studio-web/client/studio-system-page
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StudioSystemAnswer } from '@lyteboat/contracts/studio'
import { studioApi, studioErrorMessage } from './studio-api-client.ts'
import { RefreshIcon, SearchIcon } from './studio-icons.tsx'

type StudioKeyValueRow = readonly [label: string, value: string | number | readonly string[] | undefined]

function StudioKeyValueTable({ rows }: { rows: readonly StudioKeyValueRow[] }) {
  return (
    <table className="sys-kv-table">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>
              {Array.isArray(value)
                ? <div className="sys-path-list">{value.map((item: string, index: number) => <span className="sys-path-item" key={index}>{item}</span>)}</div>
                : value === undefined || value === '' ? '—' : String(value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StudioSystemSurface({ title, rows }: { title: string; rows: readonly StudioKeyValueRow[] }) {
  return (
    <div className="workspace-surface">
      <div className="surface-heading"><h3>{title}</h3></div>
      <StudioKeyValueTable rows={rows} />
    </div>
  )
}

function mebibytes(value: string | number | readonly string[] | undefined): string | undefined {
  return typeof value === 'number' ? `${(value / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} MiB` : undefined
}

function StudioEnvironmentSurface({ env }: { env: StudioSystemAnswer['env'] }) {
  const [filter, setFilter] = useState('')
  const shown = useMemo(() => {
    const text = filter.trim().toLowerCase()
    return text === '' ? env : env.filter(entry => entry.name.toLowerCase().includes(text))
  }, [env, filter])
  return (
    <div className="workspace-surface">
      <div className="surface-heading">
        <h3>Environment Variables</h3>
        <span>{shown.length} / {env.length}</span>
      </div>
      <div className="filter-bar">
        <div className="search">
          <SearchIcon />
          <input aria-label="Filter environment variables" onChange={event => setFilter(event.target.value)} placeholder="按变量名过滤…" value={filter} />
        </div>
      </div>
      <div className="sys-env-table-wrap">
        <table className="sys-env-table">
          <tbody>
            {shown.length === 0
              ? <tr><td className="sys-env-empty" colSpan={2}>无匹配的环境变量。</td></tr>
              : shown.map(entry => <tr key={entry.name}><td>{entry.name}</td><td>{entry.value}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The page at `/system`. */
export function StudioSystemPage() {
  const [data, setData] = useState<StudioSystemAnswer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await studioApi.system())
    } catch (nextError: unknown) {
      setError(studioErrorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  if (loading) return <div className="workspace-page system-props-page"><div className="empty-surface">正在加载系统属性…</div></div>
  if (error !== null || data === null) return <div className="workspace-page system-props-page"><div className="empty-surface">{error ?? '暂无数据。'}</div></div>
  const { os, runtime, lyteboat, properties } = data
  return (
    <div className="workspace-page system-props-page">
      <div className="dashboard-page-head">
        <div>
          <h1>System Properties</h1>
          <p>OS 信息、Node.js 运行时、轻舟构建、系统配置与环境变量</p>
        </div>
        <div className="dashboard-page-head-actions">
          <button className="action-button" onClick={() => void load()} type="button"><RefreshIcon />刷新</button>
        </div>
      </div>
      <div className="workspace-grid-two">
        <StudioSystemSurface rows={[['System', os['type']], ['Platform', os['platform']], ['Release', os['release']], ['Version', os['version']], ['Machine', os['machine']], ['Architecture', os['arch']], ['Hostname', os['hostname']]]} title="OS Information" />
        <StudioSystemSurface rows={[['Version', runtime['node']], ['V8', runtime['v8']], ['Executable', runtime['execPath']], ['Process ID', runtime['pid']], ['Uptime (s)', runtime['uptimeSeconds']]]} title="Node.js Information" />
      </div>
      <StudioSystemSurface rows={[['Version', lyteboat.version], ['dsh Base', lyteboat.dshBase], ['Kernel Extensions', lyteboat.extensions], ['Home', lyteboat.home], ['Agent Roots', lyteboat.agentRoots]]} title="轻舟" />
      <StudioSystemSurface rows={[['CPU Count', properties['cpuCount']], ['Byte Order', properties['endianness']], ['Total Memory', mebibytes(properties['totalMemoryBytes'])], ['Free Memory', mebibytes(properties['freeMemoryBytes'])], ['Working Directory', properties['cwd']], ['Node Options', properties['execArgv']]]} title="System Properties" />
      <StudioEnvironmentSurface env={data.env} />
    </div>
  )
}
