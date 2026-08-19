require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const methodOverride = require('method-override');
const { Pool } = require('pg');

const { loadCurrentUser } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const personRoutes = require('./routes/person');
const dmvRoutes = require('./routes/dmv');
const wantedRoutes = require('./routes/wanted');
const miscRoutes = require('./routes/misc');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(
  session({
    store: new pgSession({ pool: sessionPool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'change-me-in-.env',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 12, // 12 hours
      httpOnly: true,
    },
  })
);

app.use(loadCurrentUser);

// Every response gets access to a server clock string like the reference UI's top bar.
app.use((req, res, next) => {
  res.locals.serverTime = new Date().toLocaleTimeString('en-GB', { hour12: false });
  res.locals.appName = process.env.APP_NAME || 'Mobile Data Computer';
  res.locals.cityName = process.env.CITY_NAME || 'City of Training';
  res.locals.currentPath = req.path;
  next();
});

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/person', personRoutes);
app.use('/dmv', dmvRoutes);
app.use('/wanted', wantedRoutes);
app.use('/', miscRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'That page does not exist.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Server Error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`MDC training replica listening on port ${PORT}`);
});
