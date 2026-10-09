'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'test-output'),{recursive:true});
for(const test of ['ui-preferences-audit.cjs','updates-audit.cjs','receipt-fallback-audit.cjs','cleared-task-audit.cjs','autoconnect-audit.cjs','pair-store-audit.cjs','profile-directory-audit.cjs']){const result=spawnSync(process.execPath,[path.join(root,'tests',test)],{cwd:root,stdio:'inherit',windowsHide:true,timeout:60000});if(result.status!==0)process.exit(result.status||1);}
