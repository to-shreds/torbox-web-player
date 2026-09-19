import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, getSettings, saveSettings, resetSettings } from '../public/settings.js';
function memoryStore(){const map=new Map();return{getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
test('settings defaults are safe and useful',()=>{
  const store=memoryStore(),s=getSettings(store);
  assert.equal(s.resumeRewindSeconds,10);
  assert.equal(s.autoNext,true);assert.equal(s.autoRecovery,true);assert.equal(s.pauseOverlay,true);assert.equal(s.driveWatchOnly,true);
});
test('settings persist allowed values and reject arbitrary values',()=>{
  const store=memoryStore();
  const saved=saveSettings({resolution:'1080p',resumeRewindSeconds:15,autoNext:false,autoRecovery:false,bufferSeconds:20,recentLimit:10,pauseOverlay:false,driveWatchOnly:false},store);
  assert.deepEqual(getSettings(store),saved);
  saveSettings({resolution:'9999p',resumeRewindSeconds:999,bufferSeconds:1,recentLimit:100},store);
  const sanitized=getSettings(store);
  assert.equal(sanitized.resolution,DEFAULT_SETTINGS.resolution);
  assert.equal(sanitized.resumeRewindSeconds,DEFAULT_SETTINGS.resumeRewindSeconds);
  assert.equal(sanitized.bufferSeconds,DEFAULT_SETTINGS.bufferSeconds);
  assert.equal(sanitized.recentLimit,DEFAULT_SETTINGS.recentLimit);
});
test('reset restores defaults',()=>{const store=memoryStore();saveSettings({autoNext:false},store);assert.equal(resetSettings(store).autoNext,true);assert.equal(getSettings(store).autoNext,true);});
