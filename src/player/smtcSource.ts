import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PlayerSource, SnapshotEvent } from './types';

const SNAPSHOT_EVENT = 'player://snapshot';

/** 接收 Rust 端 SMTC 輪詢送來的快照。 */
export function createSmtcSource(): PlayerSource {
  return {
    kind: 'smtc',
    async subscribe(listener) {
      await listen<SnapshotEvent>(SNAPSHOT_EVENT, (event) => listener(event.payload));
      // 開始監聽之前送出的事件會漏掉，先補一份目前的狀態
      listener(await invoke<SnapshotEvent>('smtc_snapshot'));
    },
    async artwork() {
      // Rust 端以二進位回傳，不經過 JSON
      const buffer = await invoke<ArrayBuffer>('smtc_artwork');
      return buffer.byteLength ? new Blob([buffer]) : null;
    },
    seek: (positionMs) => invoke<boolean>('smtc_seek', { positionMs: Math.round(positionMs) }),
    togglePlayPause: () => invoke<boolean>('smtc_toggle_play_pause'),
    next: () => invoke<boolean>('smtc_next'),
    previous: () => invoke<boolean>('smtc_previous'),
  };
}
