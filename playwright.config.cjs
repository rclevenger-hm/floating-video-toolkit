const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'tests/browser',workers:1,timeout:45000,fullyParallel:false,
  reporter:[['list'],['html',{open:'never'}]],
  webServer:{command:'node scripts/fixture-server.cjs',url:'http://127.0.0.1:43123/player.html',reuseExistingServer:!process.env.CI},
});
