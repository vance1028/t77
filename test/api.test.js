'use strict';

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const { createApp } = require('../src/app');
const { waitForDb, close } = require('../src/db');
const store = require('../src/data/store');

const app = createApp();

async function login(username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  return res;
}

async function tokenOf(username, password) {
  const res = await login(username, password);
  return res.body.data.token;
}

before(async () => {
  await waitForDb();
});

beforeEach(async () => {
  await store.seed();
});

after(async () => {
  await close();
});

test('GET /api/health 返回 ok', async () => {
  const res = await request(app).get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
});

/* ---------- 登录 ---------- */

test('登录成功返回 token 和用户信息', async () => {
  const res = await login('admin', 'admin123');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.token);
  assert.strictEqual(res.body.data.user.role, 'ADMIN');
});

test('密码错误返回 401', async () => {
  const res = await login('admin', 'wrongpass');
  assert.strictEqual(res.status, 401);
});

test('用户名不存在返回 401', async () => {
  const res = await login('nobody', 'x');
  assert.strictEqual(res.status, 401);
});

test('空用户名/密码返回 400', async () => {
  const res = await login('', '');
  assert.strictEqual(res.status, 400);
});

test('GET /api/auth/me 带 token 返回当前用户', async () => {
  const token = await tokenOf('manager', 'manager123');
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.username, 'manager');
});

/* ---------- 鉴权拦截 ---------- */

test('未带 token 访问工程列表返回 401', async () => {
  const res = await request(app).get('/api/projects');
  assert.strictEqual(res.status, 401);
});

test('无效 token 返回 401', async () => {
  const res = await request(app).get('/api/projects').set('Authorization', 'Bearer not.a.token');
  assert.strictEqual(res.status, 401);
});

/* ---------- 工程查询 ---------- */

test('登录后能列出种子工程', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/projects').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.total, 4);
});

test('工程列表支持按状态筛选', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/projects?status=MAINTENANCE').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.every((p) => p.status === 'MAINTENANCE'));
});

test('工程列表支持关键词搜索', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/projects?keyword=滨江').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.length, 1);
});

test('工程详情含设备子资源接口', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/projects/1/equipments').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.length >= 1);
});

/* ---------- 角色权限 ---------- */

test('管理员能新建工程', async () => {
  const token = await tokenOf('admin', 'admin123');
  const res = await request(app).post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'RF-NEW-1', name: '新增测试工程', district: '城关区' });
  assert.strictEqual(res.status, 201);
});

test('巡检员新建工程被拒 403', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'RF-NEW-2', name: 'x' });
  assert.strictEqual(res.status, 403);
});

test('工程编号重复返回 409', async () => {
  const token = await tokenOf('admin', 'admin123');
  const res = await request(app).post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'RF-2024-001', name: '重复编号' });
  assert.strictEqual(res.status, 409);
});

test('仅管理员能删除工程；管理员删除成功 204', async () => {
  const mgr = await tokenOf('manager', 'manager123');
  const denied = await request(app).delete('/api/projects/4').set('Authorization', `Bearer ${mgr}`);
  assert.strictEqual(denied.status, 403);

  const admin = await tokenOf('admin', 'admin123');
  const ok = await request(app).delete('/api/projects/4').set('Authorization', `Bearer ${admin}`);
  assert.strictEqual(ok.status, 204);
});

/* ---------- 检查记录 ---------- */

test('巡检员能登记检查记录', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).post('/api/inspections')
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: 1, inspectDate: '2026-06-05', type: 'ROUTINE', result: 'PASS' });
  assert.strictEqual(res.status, 201);
});

test('检查记录非法日期返回 400', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).post('/api/inspections')
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: 1, inspectDate: '2026/6/5' });
  assert.strictEqual(res.status, 400);
});

test('检查记录可按工程筛选', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/inspections?projectId=1').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.every((i) => i.projectId === 1));
});

test('未知接口返回 404', async () => {
  const res = await request(app).get('/api/unknown');
  assert.strictEqual(res.status, 404);
});

/* ========== 新功能：设备全生命周期管理 ========== */

test('GET /api/equipments 返回带 lifecycle 字段', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/equipments').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.total >= 6);
  const eq = res.body.data.find((x) => x.id === 1);
  assert.ok(eq);
  assert.ok(eq.lifecycle, '必须有 lifecycle 对象');
  assert.ok('inWarranty' in eq.lifecycle);
  assert.ok('alertLevel' in eq.lifecycle);
  assert.ok(Array.isArray(eq.lifecycle.alerts));
  assert.ok(typeof eq.lifecycle.lifeUsedRatio === 'number');
});

test('GET /api/equipments/:id 返回单台设备完整信息', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/equipments/1').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  const eq = res.body.data;
  assert.strictEqual(eq.id, 1);
  assert.ok(eq.commissionDate);
  assert.ok(eq.designLifeYears);
  assert.ok(eq.maintainCycleDays);
  assert.ok(eq.lifecycle);
});

test('POST /api/equipments 创建设备含新字段', async () => {
  const token = await tokenOf('admin', 'admin123');
  const res = await request(app).post('/api/equipments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      projectId: 1,
      name: '测试通风机',
      category: 'VENTILATION',
      model: 'T-TEST',
      serialNo: 'T-2026-001',
      installDate: '2026-01-10',
      commissionDate: '2026-01-15',
      designLifeYears: 10,
      warrantyEndDate: '2027-01-14',
      maintainCycleDays: 60,
      status: 'NORMAL',
    });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.name, '测试通风机');
  assert.strictEqual(res.body.data.designLifeYears, 10);
  assert.strictEqual(res.body.data.maintainCycleDays, 60);
});

test('POST /api/equipments/:id/status 状态流转并留痕', async () => {
  const token = await tokenOf('manager', 'manager123');
  const res = await request(app).post('/api/equipments/2/status')
    .set('Authorization', `Bearer ${token}`)
    .send({ toStatus: 'MAINTENANCE', description: '测试进入维护状态', eventDate: '2026-06-12' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.status, 'MAINTENANCE');
  const hist = await request(app).get('/api/equipments/2/histories').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(hist.status, 200);
  assert.ok(hist.body.data.some((h) => h.toStatus === 'MAINTENANCE'));
});

test('POST /api/equipments/:id/status 非法流转被拒', async () => {
  const token = await tokenOf('manager', 'manager123');
  const res = await request(app).post('/api/equipments/7/status')
    .set('Authorization', `Bearer ${token}`)
    .send({ toStatus: 'NORMAL' });
  assert.strictEqual(res.status, 400);
});

test('GET /api/equipments/:id/histories 返回履历', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/equipments/6/histories').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.total >= 2);
  assert.ok(res.body.data[0].eventType);
  assert.ok('eventDate' in res.body.data[0]);
});

/* ========== 新功能：备品备件库存 ========== */

test('GET /api/spare-parts 返回库存列表含 stockStatus', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/spare-parts').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.total >= 8);
  const p = res.body.data.find((x) => x.id === 4);
  assert.strictEqual(p.stockStatus, 'OUT_OF_STOCK');
  const low = res.body.data.find((x) => x.id === 2);
  assert.strictEqual(low.stockStatus, 'LOW_STOCK');
});

test('GET /api/spare-parts/low-stock 返回预警清单', async () => {
  const token = await tokenOf('manager', 'manager123');
  const res = await request(app).get('/api/spare-parts/low-stock').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.length >= 3);
  assert.ok(res.body.data.every((s) => s.stockQty < s.safetyStock));
});

test('POST /api/spare-parts 新建备件（库存从0开始）', async () => {
  const token = await tokenOf('admin', 'admin123');
  const res = await request(app).post('/api/spare-parts')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'SP-TEST-1', name: '测试滤芯', category: 'FILTER', specification: 'T-100', unit: '个', safetyStock: 5, unitPrice: 100.50 });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.data.stockQty, 0);
  assert.strictEqual(res.body.data.safetyStock, 5);
});

test('POST /api/spare-parts/:id/stock-in 入库更新库存并写流水', async () => {
  const token = await tokenOf('manager', 'manager123');
  const before = await request(app).get('/api/spare-parts/3').set('Authorization', `Bearer ${token}`);
  const res = await request(app).post('/api/spare-parts/3/stock-in')
    .set('Authorization', `Bearer ${token}`)
    .send({ qty: 10, unitPrice: 310.00, reason: 'PURCHASE', remark: '补充采购' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.stockAfter, before.body.data.stockQty + 10);
  const moves = await request(app).get('/api/spare-parts/3/movements').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(moves.status, 200);
  assert.ok(moves.body.data.some((m) => m.movementType === 'IN' && m.qty === 10));
});

test('POST /api/spare-parts/:id/stock-out 出库库存不足被拒', async () => {
  const token = await tokenOf('manager', 'manager123');
  const res = await request(app).post('/api/spare-parts/4/stock-out')
    .set('Authorization', `Bearer ${token}`)
    .send({ qty: 5 });
  assert.strictEqual(res.status, 409);
});

test('POST /api/spare-parts/:id/stock-out 正常出库扣减库存', async () => {
  const token = await tokenOf('manager', 'manager123');
  const before = await request(app).get('/api/spare-parts/1').set('Authorization', `Bearer ${token}`);
  const qty = 2;
  const res = await request(app).post('/api/spare-parts/1/stock-out')
    .set('Authorization', `Bearer ${token}`)
    .send({ qty, reason: 'MAINTENANCE' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.stockAfter, before.body.data.stockQty - qty);
});

test('GET /api/spare-parts/:id/verify 账实校验', async () => {
  const token = await tokenOf('admin', 'admin123');
  const res = await request(app).get('/api/spare-parts/1/verify').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.matches, true);
  assert.strictEqual(res.body.data.computedStock, res.body.data.currentStock);
});

/* ========== 新功能：维修登记与备件联动 ========== */

test('POST /api/maintenances 登记维修并扣减备件', async () => {
  const token = await tokenOf('manager', 'manager123');
  const before = await request(app).get('/api/spare-parts/6').set('Authorization', `Bearer ${token}`);
  const res = await request(app).post('/api/maintenances')
    .set('Authorization', `Bearer ${token}`)
    .send({
      equipmentId: 5,
      recordType: 'REPAIR',
      startDate: '2026-06-12',
      endDate: '2026-06-12',
      faultDesc: '测试：轴承异响',
      actionDesc: '更换轴承及润滑脂',
      result: 'DONE',
      parts: [{ sparePartId: 6, qty: 2 }],
    });
  assert.strictEqual(res.status, 201);
  assert.ok(res.body.data.id);
  assert.strictEqual(res.body.data.parts.length, 1);
  assert.ok(res.body.data.totalCost > 0);
  const after = await request(app).get('/api/spare-parts/6').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(after.body.data.stockQty, before.body.data.stockQty - 2);
  const eq = await request(app).get('/api/equipments/5').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(eq.body.data.status, 'NORMAL');
});

test('POST /api/maintenances 库存不足回滚', async () => {
  const token = await tokenOf('manager', 'manager123');
  const before = await request(app).get('/api/spare-parts/4').set('Authorization', `Bearer ${token}`);
  const res = await request(app).post('/api/maintenances')
    .set('Authorization', `Bearer ${token}`)
    .send({
      equipmentId: 5, recordType: 'REPAIR', startDate: '2026-06-12',
      parts: [{ sparePartId: 4, qty: 10 }],
    });
  assert.strictEqual(res.status, 409);
  const after = await request(app).get('/api/spare-parts/4').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(after.body.data.stockQty, before.body.data.stockQty);
});

test('GET /api/spare-parts/:id/maintenances 反查备件使用记录', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/spare-parts/1/maintenances').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.every((m) => m.recordType));
});

/* ========== 新功能：统计报表 ========== */

test('GET /api/reports/overview 返回总览', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/reports/overview').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  const d = res.body.data;
  assert.ok(d.projects.total > 0);
  assert.ok(d.equipments.total > 0);
  assert.ok('intactRate' in d.equipments);
  assert.ok(d.spareParts.total >= 8);
  assert.ok('lowStock' in d.spareParts);
  assert.ok('totalCost' in d.maintenance);
});

test('GET /api/reports/equipments/by-project 返回各工程完好率', async () => {
  const token = await tokenOf('inspector', 'inspect123');
  const res = await request(app).get('/api/reports/equipments/by-project').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.total >= 4);
  const first = res.body.data[0];
  assert.ok('projectId' in first);
  assert.ok('projectName' in first);
  assert.ok('intactRate' in first);
  assert.ok('activeIntactRate' in first);
  assert.ok(typeof first.intactRate === 'number');
});

test('GET /api/reports/equipments/warranty-expiring 即将出保清单', async () => {
  const token = await tokenOf('manager', 'manager123');
  const res = await request(app).get('/api/reports/equipments/warranty-expiring?days=60').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.every((e) => e.daysLeft >= 0 && e.daysLeft <= 60));
});

test('GET /api/reports/equipments/near-end-of-life 临近到寿清单', async () => {
  const token = await tokenOf('manager', 'manager123');
  const res = await request(app).get('/api/reports/equipments/near-end-of-life').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.every((e) => e.isNear || e.isOverdue));
});

test('GET /api/reports/spare-parts/low-stock 库存预警清单', async () => {
  const token = await tokenOf('manager', 'manager123');
  const res = await request(app).get('/api/reports/spare-parts/low-stock').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.length >= 3);
});

test('GET /api/reports/equipments/problem-top 问题设备排名', async () => {
  const token = await tokenOf('manager', 'manager123');
  const res = await request(app).get('/api/reports/equipments/problem-top?limit=5').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  if (res.body.data.length) {
    const top = res.body.data[0];
    assert.ok('repairCount' in top);
    assert.ok('totalCost' in top);
  }
});
