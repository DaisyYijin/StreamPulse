import { api } from '../api'
import { useToast } from '../stores/ui'

// 任务化操作统一走这里:后端一律 202 入队(重复点击自动合并),
// toast 提示后在任务页看进度。
export async function submitTask(
  call: () => Promise<{ taskId: number; reused?: boolean }>,
  label: string,
) {
  const toast = useToast()
  try {
    const r = await call()
    toast.ok(r.reused ? `${label}：已合并到排队中的任务` : `${label}：已提交，正在排队执行`)
    return r.taskId
  } catch (e: any) {
    toast.bad(`${label}：${e.message}`)
    return 0
  }
}

export function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + units[i]
}

export function fmtTime(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

export const DEVICE_OPTIONS = [
  { value: 'web', label: '网页' },
  { value: '115android', label: 'Android' },
  { value: '115ios', label: 'iOS' },
  { value: '115ipad', label: 'iPad' },
  { value: 'tv', label: 'TV' },
  { value: 'alipaymini', label: '支付宝小程序' },
  { value: 'wechatmini', label: '微信小程序' },
  { value: 'qandroid', label: 'QAndroid' },
]
