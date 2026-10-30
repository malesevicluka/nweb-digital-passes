import express from 'express';
import helmet from 'helmet';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import oidc from 'express-openid-connect';
import bearer from 'express-oauth2-jwt-bearer';

export function createApp({ store, config }) {
  const app = express();

  app.set('view engine', 'pug');
  app.set('views', 'views');
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        formAction: ["'self'", new URL(config.issuer).origin]
      }
    }
  }));
  app.use(express.static('public'));
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));

  app.use(oidc.auth({
    authRequired: false,
    idpLogout: true,
    auth0Logout: true,
    secret: config.sessionSecret,
    baseURL: config.baseURL,
    clientID: config.clientID,
    clientSecret: config.clientSecret,
    issuerBaseURL: config.issuer,
    authorizationParams: {
      response_type: 'code',
      scope: 'openid profile email'
    },
    routes: { logout: false }
  }));

  const checkToken = bearer.auth({
    audience: config.audience,
    issuerBaseURL: config.issuer,
    tokenSigningAlg: 'RS256'
  });

  function requireScope(requiredScope) {
    return function (req, res, next) {
      const scopes = String(req.auth?.payload?.scope || '').split(' ');
      if (!scopes.includes(requiredScope)) {
        return res.status(403).json({ error: 'insufficient_scope' });
      }
      next();
    };
  }

  function getCsrfToken(req) {
    return crypto.createHmac('sha256', config.sessionSecret)
      .update(`${req.oidc.user.sub}:${req.oidc.idToken}`)
      .digest('hex');
  }

  function checkCsrf(req, res, next) {
    const expected = Buffer.from(getCsrfToken(req));
    const received = Buffer.from(String(req.body?._csrf || ''));
    if (received.length !== expected.length ||
        !crypto.timingSafeEqual(received, expected)) {
      return res.status(403).render('error', {
        title: 'Neispravan zahtjev',
        message: 'Zahtjev nije valjan. Vratite se na početnu stranicu.'
      });
    }
    next();
  }

  app.locals.formatDate = function (value) {
    return new Date(value).toLocaleString('hr-HR', {
      timeZone: 'Europe/Zagreb'
    });
  };

  app.get('/health', async function (req, res, next) {
    try {
      await store.counts();
      res.json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/', async function (req, res, next) {
    try {
      const counts = await store.counts();
      const authenticated = req.oidc.isAuthenticated();
      let passes = [];
      let user = null;
      let csrfToken = '';

      if (authenticated) {
        passes = await store.list();
        user = req.oidc.user;
        csrfToken = getCsrfToken(req);
      }

      res.set('Cache-Control', 'no-store');
      res.render('index', {
        title: 'Digitalne propusnice',
        counts, authenticated, passes, user, csrfToken
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/logout', oidc.requiresAuth(), checkCsrf, async function (req, res, next) {
    try {
      await res.oidc.logout({ returnTo: config.baseURL });
    } catch (error) {
      next(error);
    }
  });

  app.get('/info/:id', async function (req, res, next) {
    try {
      const pass = await store.get(req.params.id);
      res.set('Cache-Control', 'no-store');
      if (!pass) {
        return res.status(404).render('error', {
          title: 'Propusnica nije pronađena',
          message: 'Ne postoji propusnica s navedenim identifikatorom.'
        });
      }
      res.render('pass', { title: 'Podaci propusnice', pass });
    } catch (error) {
      next(error);
    }
  });

  app.get('/passes/:id', checkToken, requireScope('read:passes'), async function (req, res, next) {
    try {
      const pass = await store.get(req.params.id);
      res.set('Cache-Control', 'no-store');
      if (!pass) {
        return res.status(404).json({ error: 'not_found' });
      }
      res.json(pass);
    } catch (error) {
      next(error);
    }
  });

  app.post('/passes', checkToken, requireScope('create:passes'), async function (req, res, next) {
    try {
      const { name, document } = req.body || {};
      if (typeof name !== 'string' || typeof document !== 'string' ||
          !name.trim() || !document.trim()) {
        return res.status(400).json({ error: 'name and document are required' });
      }

      const id = crypto.randomUUID();
      const publicUrl = `${config.baseURL}/info/${id}`;
      const qrCode = await QRCode.toBuffer(publicUrl, {
        type: 'png',
        width: 360,
        margin: 2
      });
      await store.create(id, name.trim(), document.trim());

      res.status(201);
      res.location(`${config.baseURL}/passes/${id}`);
      res.set('Cache-Control', 'no-store');
      res.type('png').send(qrCode);
    } catch (error) {
      next(error);
    }
  });

  app.post('/manage/:id/cancel', oidc.requiresAuth(), checkCsrf, async function (req, res, next) {
    try {
      const found = await store.cancel(req.params.id);
      if (!found) {
        return res.status(404).render('error', {
          title: 'Propusnica nije pronađena',
          message: 'Propusnica ne postoji.'
        });
      }
      res.redirect(303, '/');
    } catch (error) {
      next(error);
    }
  });

  app.post('/manage/:id/delete', oidc.requiresAuth(), checkCsrf, async function (req, res, next) {
    try {
      const found = await store.delete(req.params.id);
      if (!found) {
        return res.status(404).render('error', {
          title: 'Propusnica nije pronađena',
          message: 'Propusnica ne postoji.'
        });
      }
      res.redirect(303, '/');
    } catch (error) {
      next(error);
    }
  });

  app.use(function (req, res) {
    res.status(404).render('error', {
      title: 'Stranica nije pronađena',
      message: 'Tražena stranica ne postoji.'
    });
  });

  app.use(function (error, req, res, next) {
    const status = error.status || error.statusCode || 500;
    if (status >= 500) {
      console.error('Request failed:', error.code || error.name);
    }
    if (error.headers) {
      res.set(error.headers);
    }

    let message = 'request_failed';
    if (status === 500) message = 'internal_server_error';
    if (status === 401) message = 'invalid_token';
    if (status === 400) message = 'invalid_request';
    res.status(status).json({ error: message });
  });

  return app;
}
