'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendError, toPositiveInt } = require('../utils/http');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(authRequired);

router.get('/overview', wrap(async (req, res) => {
  const data = await store.getOverallStats();
  res.json({ data });
}));

router.get('/equipments/by-project', wrap(async (req, res) => {
  const list = await store.getEquipmentStatsByProject();
  res.json({ data: list, total: list.length });
}));

router.get('/equipments/warranty-expiring', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const days = req.query.days ? Number(req.query.days) : 30;
  if (!Number.isInteger(days) || days <= 0) return sendError(res, 400, '天数必须是正整数');
  const list = await store.getEquipmentsWarrantyExpiring(days);
  res.json({ data: list, total: list.length, withinDays: days });
}));

router.get('/equipments/warranty-expired', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const list = await store.getEquipmentsWarrantyExpired();
  res.json({ data: list, total: list.length });
}));

router.get('/equipments/near-end-of-life', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const months = req.query.months ? Number(req.query.months) : 6;
  if (!Number.isInteger(months) || months <= 0) return sendError(res, 400, '月份必须是正整数');
  const list = await store.getEquipmentsNearEndOfLife(months);
  res.json({ data: list, total: list.length, withinMonths: months });
}));

router.get('/equipments/maintenance-due', requireRole('ADMIN', 'MANAGER', 'INSPECTOR'), wrap(async (req, res) => {
  const list = await store.getEquipmentsMaintenanceDue();
  res.json({ data: list, total: list.length });
}));

router.get('/spare-parts/low-stock', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const list = await store.getLowStockAlertList();
  res.json({ data: list, total: list.length });
}));

router.get('/equipments/problem-top', requireRole('ADMIN', 'MANAGER'), wrap(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    return sendError(res, 400, '数量必须是 1~100 的正整数');
  }
  const list = await store.getProblemEquipmentsTop(limit);
  res.json({ data: list, total: list.length });
}));

module.exports = router;
