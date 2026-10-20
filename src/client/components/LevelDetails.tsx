import {Accordion, AccordionDetails, AccordionSummary, Box, Chip, Paper, Stack, Typography} from '@mui/material';
import {getLevelPreview, LEVEL_SUMMARIES} from '../../shared/levels.ts';
import {FACTIONS, ROLES, ROLE_DETAILS, type GameLevel} from '../../shared/rules.ts';

export function LevelDetails({level, playerCount}: {level: GameLevel; playerCount: number}) {
  const preview = getLevelPreview(level, playerCount);
  return (
    <Paper component="section" aria-labelledby="level-details-heading" variant="outlined" sx={{p:{xs:2,md:3},minWidth:0}}>
      <Stack spacing={2}>
        <Typography id="level-details-heading" component="h2" variant="h3">關卡角色與規則</Typography>
        <Typography sx={{fontWeight:700}}>{level} · {LEVEL_SUMMARIES[level]}</Typography>
        <Typography variant="body2" color="text.secondary">
          {playerCount} 位玩家 · 完整牌池 {preview.poolCount} 張 · 牌堆 {preview.deckCount} 張。每人最後保留 1 張，另 1 張留在客房。
        </Typography>
        {preview.setAsideCount > 0 && <Typography variant="body2">先隨機扣置 {preview.setAsideCount} 張非兇手卡，不放入牌堆。</Typography>}
        {preview.removedCount > 0 && <Typography variant="body2">再隨機移除 {preview.removedCount} 張非兇手卡，本局不使用。</Typography>}
        <Typography variant="body2" color="text.secondary">以下為完整配置牌池，包含可能被扣置、移除或留在客房的角色，不代表每個角色都在玩家手中。點開角色可查看目標及能力。</Typography>
        <Box>
          {preview.roles.map(({roleId,count}) => (
            <Accordion key={roleId} disableGutters elevation={0} sx={{border:'1px solid',borderColor:'divider','&:before':{display:'none'}}}>
              <AccordionSummary aria-controls={`level-role-${roleId}`} id={`level-role-heading-${roleId}`} expandIcon={<span aria-hidden="true">⌄</span>}>
                <Stack direction="row" spacing={1.5} sx={{alignItems:'center',flexWrap:'wrap',minWidth:0,gap:1}}>
                  <Box component="img" src={`/art/${roleId}.webp`} alt="" sx={{width:34,height:46,objectFit:'cover',borderRadius:1}}/>
                  <Typography sx={{fontWeight:700}}>{ROLES[roleId].label} × {count}</Typography>
                  <Chip size="small" variant="outlined" label={FACTIONS[ROLES[roleId].faction].label}/>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1}>
                  <Typography variant="body2">目標：{ROLE_DETAILS[roleId].objective}</Typography>
                  <Typography variant="body2">能力：{ROLE_DETAILS[roleId].ability}</Typography>
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      </Stack>
    </Paper>
  );
}
