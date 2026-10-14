'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, validateProfile } = require('../lib/plan');

const base = { heightCm: 170, weightKg: 95, age: 30, sex: 'male', activity: 'light' };

test('sobrepeso u obesidad: plan de pérdida moderada', () => {
  const p = buildPlan(base);
  assert.equal(p.goal, 'lose');
  assert.ok(p.metrics.targetKcal < p.metrics.tdee);
  assert.ok(p.metrics.targetKcal >= p.metrics.tdee * 0.78, 'déficit no mayor a ~20 %');
});

test('peso normal: mantener. Bajo peso: subir', () => {
  assert.equal(buildPlan({ ...base, weightKg: 65 }).goal, 'maintain');
  const low = buildPlan({ ...base, weightKg: 50 });
  assert.equal(low.goal, 'gain');
  assert.ok(low.metrics.targetKcal > low.metrics.tdee);
});

test('IMC muy bajo avisa que consulte a un profesional', () => {
  assert.ok(buildPlan({ ...base, weightKg: 45 }).warnings.some((w) => /profesional/.test(w)));
});

test('menores de edad nunca reciben plan de pérdida de peso', () => {
  const p = buildPlan({ ...base, age: 15 });
  assert.equal(p.goal, 'maintain');
  assert.ok(p.warnings.some((w) => /menor de edad/.test(w)));
  assert.equal(p.metrics.targetKcal, p.metrics.tdee);
});

test('condición de salud especial: solo mantenimiento y aviso', () => {
  const p = buildPlan({ ...base, hasCondition: true });
  assert.equal(p.goal, 'maintain');
  assert.ok(p.warnings.length >= 1);
});

test('la meta de calorías de un plan de pérdida nunca baja del mínimo seguro', () => {
  for (const sex of ['male', 'female'])
    for (const heightCm of [150, 160, 175, 190])
      for (const weightKg of [60, 80, 100, 140, 200])
        for (const age of [18, 30, 55, 80])
          for (const activity of ['sedentary', 'light', 'moderate', 'high']) {
            const p = buildPlan({ heightCm, weightKg, age, sex, activity });
            if (p.goal === 'lose') {
              assert.ok(p.metrics.targetKcal >= (sex === 'male' ? 1500 : 1200), JSON.stringify({ sex, heightCm, weightKg, age, activity, k: p.metrics.targetKcal }));
            }
          }
});

test('la semana trae 7 días con comidas, y bebidas y rutinas del objetivo', () => {
  const p = buildPlan(base);
  assert.equal(p.week.length, 7);
  for (const d of p.week) assert.ok(d.items.length >= 4);
  assert.equal(p.workouts.length, 7);
  assert.ok(p.drinks.length > 0);
});

test('validateProfile rechaza valores fuera de rango o incompletos', () => {
  assert.deepEqual(validateProfile(base), []);
  assert.ok(validateProfile({ ...base, heightCm: 50 }).length);
  assert.ok(validateProfile({ ...base, weightKg: 10 }).length);
  assert.ok(validateProfile({ ...base, age: 5 }).length);
  assert.ok(validateProfile({ ...base, sex: 'x' }).length);
  assert.ok(validateProfile({ ...base, activity: 'y' }).length);
  assert.ok(validateProfile({ ...base, heightCm: NaN }).length);
});
