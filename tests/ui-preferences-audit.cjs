'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createPreferences}=require('../desktop/ui-preferences.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bambu-preferences-'));
fs.writeFileSync(path.join(dir,'ui-preferences.json'),JSON.stringify({language:'zh-CN'}));
let prefs=createPreferences(dir,'en');assert.deepEqual(prefs.get(),{language:'zh-CN',theme:'system'});
prefs.patch({theme:'dark'});prefs.patch({language:'en'});prefs=createPreferences(dir,'zh-CN');assert.deepEqual(prefs.get(),{language:'en',theme:'dark'});
const before=fs.readFileSync(path.join(dir,'ui-preferences.json'),'utf8');for(const bad of [{theme:'invalid'},{language:'fr'},{printer:'lost'}])assert.throws(()=>prefs.patch(bad));assert.equal(fs.readFileSync(path.join(dir,'ui-preferences.json'),'utf8'),before);
console.log('PASS legacy language migration, theme/language preservation, restart and rejected preference changes');
