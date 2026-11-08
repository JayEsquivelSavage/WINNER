import config from '../../spacetimedb/vitest.config.js';
export default {...config,cacheDir:'lab/.vite',test:{...config.test,include:['lab/conformance.test.ts'],pool:'forks',minWorkers:1,maxWorkers:1}};
