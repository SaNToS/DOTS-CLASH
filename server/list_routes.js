const express = require('express');
const app = express();
const authRoutes = require('./routes/auth');

app.use('/api/auth', authRoutes);
app.use('/api', authRoutes);

// In Express 5, the router is initialized on the first interaction
// or we can manually check the lazy-loaded router.
function listRoutes(app) {
    const stack = app._router ? app._router.stack : (app.router ? app.router.stack : []);
    if (stack.length === 0 && app.lazyrouter) {
        app.lazyrouter();
        return listRoutes(app);
    }
    
    const routes = [];
    stack.forEach(layer => {
        if (layer.route) {
            routes.push({
                path: layer.route.path,
                method: Object.keys(layer.route.methods).join(',').toUpperCase()
            });
        } else if (layer.name === 'router') {
            const prefix = layer.regexp.source.replace('^\\', '').replace('\\/?(?=\\/|$)', '').replace('\\/', '/').replace('\\', '');
            layer.handle.stack.forEach(subLayer => {
                if (subLayer.route) {
                    routes.push({
                        path: prefix + subLayer.route.path,
                        method: Object.keys(subLayer.route.methods).join(',').toUpperCase()
                    });
                }
            });
        }
    });
    return routes;
}

// Trigger lazy router
app.get('/', (req, res) => {}); 

console.log('Registered Routes:');
console.log(JSON.stringify(listRoutes(app), null, 2));
