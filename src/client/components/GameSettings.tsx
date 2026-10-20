import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogContent, DialogTitle, FormControlLabel, Slider, Stack, Switch, Typography } from '@mui/material';
import type { GameClient } from '../net.ts';
import { audioManager } from '../audio/manager.ts';

export function GameSettings({ client }: { client: GameClient }) {
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState(audioManager.getPreferences());
  const [voice, setVoice] = useState(client.voice.getState());
  useEffect(() => { setVoice(client.voice.getState()); return client.voice.subscribe(() => setVoice(client.voice.getState())); }, [client]);
  return <><Button id="btn-app-menu" variant="outlined" onClick={() => setOpen(true)}>☰ Menu 選單</Button><Dialog open={open} onClose={() => setOpen(false)}><DialogTitle>音效及語音設定</DialogTitle><DialogContent><Stack spacing={2}>
    <FormControlLabel label="靜音遊戲音效" control={<Switch checked={preferences.muted} onChange={(_, checked) => { audioManager.setMuted(checked); setPreferences(audioManager.getPreferences()); }}/>}/>
    <FormControlLabel label="酒館環境聲" control={<Switch checked={preferences.ambienceEnabled} onChange={(_, checked) => { audioManager.setAmbienceEnabled(checked); setPreferences(audioManager.getPreferences()); }}/>}/>
    <Typography id="game-volume-label">遊戲音效音量</Typography><Slider aria-labelledby="game-volume-label" min={0} max={1} step={0.05} value={preferences.masterVolume} onChange={(_, value) => { audioManager.setMasterVolume(value as number); setPreferences(audioManager.getPreferences()); }}/>
    <Typography id="voice-volume-label">對方語音音量</Typography><Slider aria-labelledby="voice-volume-label" min={0} max={1} step={0.05} value={voice.outputVolume} onChange={(_, value) => client.voice.setOutputVolume(value as number)}/>
    <Typography id="mic-gain-label">麥克風增益</Typography><Slider aria-labelledby="mic-gain-label" min={0} max={2} step={0.1} value={voice.micGain} onChange={(_, value) => client.voice.setMicGain(value as number)}/>
    <Typography color="text.secondary">語音僅在討論階段開放。麥克風預設關閉。</Typography>
    <Button id="btn-toggle-mic" aria-pressed={voice.micEnabled} variant="outlined" disabled={!voice.active} onClick={() => { void client.voice.setMicEnabled(!voice.micEnabled && !voice.micPending); }}>{voice.micPending ? '取消開啟麥克風' : voice.micEnabled ? '關閉麥克風' : '開啟麥克風'}</Button>
    <Button id="btn-resume-voice" onClick={() => { void client.voice.resumePlayback(); }}>開啟語音播放</Button>
    {voice.error && <Alert severity="warning">{voice.error}</Alert>}
    {voice.peers.map(peer => <Typography variant="body2" key={peer.playerId}>{peer.playerId.slice(0, 8)} · {peer.connectionState}</Typography>)}
    <Button onClick={() => setOpen(false)}>完成</Button>
  </Stack></DialogContent></Dialog></>;
}
