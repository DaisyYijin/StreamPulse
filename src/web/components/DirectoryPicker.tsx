import { ChevronLeft, Folder, FolderOpen, HardDrive, Loader2, Music2, Film } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BrowseResult } from '../../shared/types';
import { api } from '../api';
import { formatBytes } from '../utils';
import { Button, Modal } from './ui';

export function DirectoryPicker({
  open,
  sourceId,
  sourceName,
  initialPath,
  onClose,
  onSelect,
}: {
  open: boolean;
  sourceId: string;
  sourceName: string;
  initialPath: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [currentPath, setCurrentPath] = useState(initialPath || '/');
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!open) return;
    setCurrentPath(initialPath || '/');
  }, [open, initialPath, sourceId]);

  useEffect(() => {
    if (!open || !sourceId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .get<BrowseResult>(`/api/sources/${sourceId}/browse?path=${encodeURIComponent(currentPath)}`)
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '目录加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sourceId, currentPath, reloadToken]);

  const segments = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);
  const parentPath =
    currentPath === '/' ? '/' : `/${segments.slice(0, -1).join('/')}`.replace(/\/$/, '') || '/';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="浏览来源目录"
      description={`${sourceName} · 选择媒体文件所在的文件夹`}
      size="md"
      footer={
        <>
          <div className="picker-selected">
            <FolderOpen size={15} />
            <span>{currentPath}</span>
          </div>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => onSelect(currentPath)}>
            选择此目录
          </Button>
        </>
      }
    >
      <div className="picker">
        <div className="picker-bar">
          <button
            className="icon-btn"
            onClick={() => setCurrentPath(parentPath)}
            disabled={currentPath === '/'}
            aria-label="返回上一级"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="breadcrumb">
            <button onClick={() => setCurrentPath('/')} className={currentPath === '/' ? 'active' : ''}>
              <HardDrive size={14} /> 根目录
            </button>
            {segments.map((segment, index) => {
              const target = `/${segments.slice(0, index + 1).join('/')}`;
              return (
                <span key={target}>
                  <i>/</i>
                  <button
                    onClick={() => setCurrentPath(target)}
                    className={target === currentPath ? 'active' : ''}
                  >
                    {segment}
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        <div className="picker-list">
          {loading ? (
            <div className="picker-state">
              <Loader2 className="spin" size={22} />
              <span>正在读取目录…</span>
            </div>
          ) : error ? (
            <div className="picker-state picker-error">
              <span>{error}</span>
              <Button size="sm" onClick={() => setReloadToken((value) => value + 1)}>
                重试
              </Button>
            </div>
          ) : !result || result.entries.length === 0 ? (
            <div className="picker-state">
              <Folder size={26} />
              <span>这个目录是空的</span>
            </div>
          ) : (
            result.entries.map((entry) => (
              <button
                key={entry.path}
                className={`picker-row ${entry.isDir ? '' : 'picker-row-file'}`}
                onClick={() => {
                  if (entry.isDir) setCurrentPath(entry.path);
                }}
                disabled={!entry.isDir}
              >
                <span className={`picker-entry-icon ${entry.isDir ? 'folder' : 'file'}`}>
                  {entry.isDir ? (
                    <Folder size={18} />
                  ) : /\.(mkv|mp4|avi|ts|mov|m2ts|wmv|flv|webm|rmvb|iso)$/i.test(entry.name) ? (
                    <Film size={18} />
                  ) : (
                    <Music2 size={18} />
                  )}
                </span>
                <span className="picker-entry-name">{entry.name}</span>
                <span className="picker-entry-meta">
                  {entry.isDir ? '文件夹' : formatBytes(entry.size)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
