import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, getSettings, saveSettings, resetSettings } from '../public/settings.js';
function memoryStore(){const map=new Map();return{getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
test('settings default to simple family-friendly mode with smart automation',()=>{
  const s=getSettings(memoryStore());
  assert.equal(s.interfaceMode,'simple');assert.equal(s.resumeRewindSeconds,10);assert.equal(s.autoNext,true);assert.equal(s.autoRecovery,true);
  assert.equal(s.showNextUp,true);assert.equal(s.showSearchHistory,true);assert.equal(s.autoLearnSources,true);assert.equal(s.cleanupCompletedEpisodes,true);
});
test('expanded settings persist allowed values and reject arbitrary values',()=>{
  const store=memoryStore();
  const saved=saveSettings({interfaceMode:'full',resolution:'1080p',resumeRewindSeconds:15,autoNext:false,autoNextDelaySeconds:10,autoRecovery:false,bufferSeconds:20,recentLimit:16,pauseOverlay:false,driveWatchOnly:false,driveDeleteMinutes:30,showCompletedRecent:true,cleanupCompletedEpisodes:false,playbackRate:1.5,sleepTimerMinutes:45,keepAwake:false,keyboardShortcuts:false,seekSeconds:30,showEpisodeProgress:false,rememberBrowse:false,sourceSizeProfile:'quality',showWatchlist:false,watchlistLimit:24,showNextUp:false,nextUpLimit:12,showSearchHistory:false,searchHistoryLimit:12,longPressShortcuts:false,showPlaybackHealth:false,autoLearnSources:false},store);
  assert.deepEqual(getSettings(store),saved);
  saveSettings({interfaceMode:'expert',resolution:'9999p',resumeRewindSeconds:999,bufferSeconds:1,recentLimit:100,autoNextDelaySeconds:77,playbackRate:9,sleepTimerMinutes:7,seekSeconds:99,sourceSizeProfile:'huge',watchlistLimit:999,nextUpLimit:99,searchHistoryLimit:99,driveDeleteMinutes:999},store);
  const s=getSettings(store);
  for(const key of ['interfaceMode','resolution','resumeRewindSeconds','bufferSeconds','recentLimit','autoNextDelaySeconds','playbackRate','sleepTimerMinutes','seekSeconds','sourceSizeProfile','watchlistLimit','nextUpLimit','searchHistoryLimit','driveDeleteMinutes'])assert.equal(s[key],DEFAULT_SETTINGS[key],key);
});
test('remembered browse values are constrained',()=>{
  const store=memoryStore();saveSettings({catalogType:'series',catalogFeed:'new',catalogGenre:'Comedy'},store);assert.equal(getSettings(store).catalogGenre,'Comedy');
  saveSettings({catalogType:'book',catalogFeed:'random',catalogGenre:'NotAGenre'},store);const s=getSettings(store);assert.equal(s.catalogType,'movie');assert.equal(s.catalogFeed,'popular');assert.equal(s.catalogGenre,'');
});
test('reset restores defaults',()=>{const store=memoryStore();saveSettings({interfaceMode:'full',autoNext:false},store);assert.equal(resetSettings(store).interfaceMode,'simple');assert.equal(getSettings(store).autoNext,true);});
