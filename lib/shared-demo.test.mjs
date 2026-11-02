import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {dayInJapan,demoModel} from './shared-demo.mjs';
function database(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE demo_usage(day TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0); CREATE TABLE api_settings(id INTEGER PRIMARY KEY, encrypted_key TEXT, iv TEXT, model TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)');return {prepare(query){return {async first(){return sql.prepare(query).get()||null},bind(...args){return {async first(){return sql.prepare(query).get(...args)||null}}}}}}}
const make=()=>{const form=new FormData();form.append('prompt','議事録を作成');return new Request('https://example.test/api/shared-generate',{method:'POST',headers:{Origin:'https://example.test'},body:form})};
const upstream=async(url,init)=>{const body=JSON.parse(init.body);assert(!JSON.stringify(body).includes('test-secret'));return Response.json(url.endsWith(':countTokens')?{totalTokens:1000}:{candidates:[{content:{parts:[{text:'議事録'}]}}]})};
test('日本時間0時のリセット境界',()=>{assert.equal(dayInJapan(Date.parse('2026-11-02T14:59:59Z')),'2026-11-02');assert.equal(dayInJapan(Date.parse('2026-11-02T15:00:00Z')),'2026-11-03')});
test('共有モデルはサーバーの許可済み設定のみ使用',()=>{assert.equal(demoModel({GEMINI_MODEL:'other'}),'gemini-3.5-flash-lite');assert.equal(demoModel({GEMINI_MODEL:'gemini-3.8-flash'}),'gemini-3.8-flash')});
