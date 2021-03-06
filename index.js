/*
 * Copyright 2018 Zane Littrell
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const serverless = require('serverless-http');
const bodyParser = require('body-parser');
const express = require('express');
const cookie = require('cookie-parser');
const hbs = require('hbs');
const gzip = require('compression');
const SolrNode = require('solr-node');
const app = express();
const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const Posts = require('./posts');
const Login = require('./login');
const Features = require('./features');
const Subscribers = require('./subscribers');
const InfiniteTimeline = require('./infinite_timeline');
const Quizzes = require('./quizzes');
const InstaShorts = require('./insta_shorts');
const Crosswords = require('./crosswords');
const Videos = require('./videos');
const Issues = require('./issues');

const IS_OFFLINE = process.env.IS_OFFLINE;
const BASE_URL = 'https://thefishwrapper.news';

let dynamoDb;
if (IS_OFFLINE === 'true') {
  dynamoDb = new AWS.DynamoDB.DocumentClient({
    region: 'localhost',
    endpoint: 'http://localhost:8000'
  });
  console.log(dynamoDb);
} else {
  dynamoDb = new AWS.DynamoDB.DocumentClient();
}

let s3 = new AWS.S3();

let mulS3 = multerS3({
  s3: s3,
  bucket: process.env.PICS_BUCKET,
  cacheControl: 'max-age=31536000',
  acl: 'public-read',
  contentType: function (req, file, cb) {
    cb(null, file.mimetype);
  },
  metadata: function (req, file, cb) {
    cb(null, {
      fieldName: file.fieldname,
    });
  },
  key: function (req, file, cb) {
    cb(null, Date.now().toString() + '-' + file.originalname)
  }
});

let upload = multer({ storage: mulS3 });

hbs.registerHelper('blurb', function (content) {
  const sentenceRegex = /<\/p>/g;
  let stopAr = sentenceRegex.exec(content);
  if (!stopAr) {
    return content;
  }
  return content.substr(0, stopAr.index) + '...';
});
hbs.registerHelper('caro', function (items, options) {
  var out = '<div class="carousel-inner" role="listbox">';
  for (var i = 0; i < items.length; i++) {
    out += '<div class="carousel-item';
    if (i == 0) {
      out += ' active">';
    } else {
      out += '">';
    }
    out += options.fn(items[i]);
    out += '</div>';
  }
  out += '</div>';
  return out;
});
hbs.registerHelper('first', function (context, options) {
  let out = '';
  for (let i = 0; i < options.hash['num']; i++) {
    if (context[i] != undefined) {
      out += options.fn(context[i]);
    }
  }
  return out;
});
hbs.registerHelper('last', function (context, options) {
  let out = '';
  let num = parseInt(options.hash['start']) + parseInt(options.hash['num']);
  for (let i = options.hash['start']; i < Math.min(context.length, num); i++) {
    if (context[i] != undefined) {
      out += options.fn(context[i]);
    }
  }
  return out;
});
hbs.registerHelper('checkedIf', function (test) { return (test) ? 'checked' : ''; });
hbs.registerHelper('selected', function (sel) { return (sel) ? 'selected' : ''; });
hbs.registerHelper('equal', function (a, b) { return (a == b) ? 'selected' : ''; });
hbs.registerHelper('image', function (image) {
  return (image) ? image : 'https://via.placeholder.com/350?text=Image not found';
});
hbs.registerPartials(__dirname + '/views/partials');

app.use(bodyParser.json({ strict: false }));
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
  extended: true
}));
app.use(cookie(process.env.COOKIE_SECRET));
app.use(gzip());
app.set('view engine', 'hbs');
let bucket = process.env.S3_BUCKET;

let handlerObj = {
  req: null,
  res: null,
  callback: function (action, page, obj) {
    switch (action) {
      case 'render':
        this.res.render(page, Object.assign({bucket: process.env.S3_BUCKET,
          req: this.req, title: 'The Fishwrapper', type: 'article',
          description: "The Fishwrapper is UW's own satirical newspaper, " +
          "committed to publishing all the news that's unfit to print. " +
          "Irrelevant, irreverent, irresponsible.", url: BASE_URL,
          ogImage: process.env.S3_BUCKET + 'logo.png'}, obj));
        break;
      case 'cookie': // Sets cookie and redirects to page
        this.res.cookie(obj.cookie, obj.value, obj.options);
      case 'redirect':
        this.res.redirect(page);
        break;
      default:
        console.log('Unknown action');
     }
   }
};

app.get('/', function (req, res) {
  Posts.index(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.get('/login', function (req, res) {
  Login.show(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.post('/login', function (req, res) {
  Login.attempt(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.get('/logout', function (req, res) {
  Login.logout(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.get('/posts', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  if (req.query.search) {
    Posts.search(req, dynamoDb, cb);
  } else if (req.query.category) {
    Posts.category(req, dynamoDb, cb);
  } else {
    Posts.index(req, dynamoDb, cb);
  }
});

app.get('/posts/new', function(req, res) {
  Posts.new_post(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.get('/posts/:postId', function (req, res) {
  Posts.read(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.get('/posts/:postId/edit', function (req, res) {
  Posts.edit(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.get('/posts/:postId/delete', function (req, res) {
  Posts.destroy(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.post('/posts', upload.single('thumbnail'), function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  if (req.body._method == 'PUT') {
    Posts.update(req, dynamoDb, cb);
  } else if (req.body._method == 'POST') {
    Posts.create(req, dynamoDb, cb);
  }
});

app.get('/staging', function (req, res) {
  Posts.staging(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.get('/features', function (req, res) {
  Features.index(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.get('/features/new', function (req, res) {
  Features.new_feat(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.get('/features/:index/edit', function (req, res) {
  Features.edit(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.get('/features/:index/delete', function (req, res) {
  Features.destroy(req, dynamoDb, handlerObj.callback.bind({req: req, res: res}));
});

app.post('/features', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  if (req.body._method == 'PUT') {
    Features.update(req, dynamoDb, cb);
  } else if (req.body._method == 'POST') {
    Features.create(req, dynamoDb, cb);
  }
});

app.get('/about', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  cb('render', 'about');
});

app.get('/contact', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  cb('render', 'contact');
});

app.get('/subscribers/new', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  Subscribers.new_subscriber(req, dynamoDb, cb);
});

app.get('/subscribers/delete', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  Subscribers.delete(req, dynamoDb, cb);
});

app.post('/subscribers', function(req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  if (req.body._method == 'POST') {
    Subscribers.create(req, dynamoDb, cb);
  } else if (req.body._method == 'DELETE') {
    Subscribers.destroy(req, dynamoDb, cb);
  }
});

app.get('/reindex', function (req, res) {
  const solr = new SolrNode({
    host: process.env.SOLR_SITE,
    port: process.env.SOLR_PORT,
    core: process.env.SOLR_CORE,
    protocol: 'http'
  });
  dynamoDb.scan({TableName: process.env.POSTS_TABLE}, (error, result) => {
    if (error) {
      console.log(error);
    } else {
      for (let i = 0; i < result.Items.length; i++) {
        Posts.solrPost(result.Items[i]);
      }
    }
    res.redirect('/');
  });
});

app.get('/infinite_timeline', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  InfiniteTimeline.index(req, dynamoDb, cb);
});

app.get('/infinite_timeline/new', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  InfiniteTimeline.new_story(req, dynamoDb, cb);
});

app.get('/infinite_timeline/edit', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  InfiniteTimeline.edit(req, dynamoDb, cb);
});

app.post('/infinite_timeline', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  if (req.body._method === 'POST') {
    InfiniteTimeline.create(req, dynamoDb, cb);
  } else if (req.body._method === 'PUT') {
    InfiniteTimeline.update(req, dynamoDb, cb);
  }
});

app.get('/infinite_timeline/week', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  InfiniteTimeline.changeWeek(req, dynamoDb, cb);
});

app.post('/infinite_timeline/week', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  InfiniteTimeline.setWeek(req, dynamoDb, cb);
});

app.get('/infinite_timeline/clean', function (req, res) {
  let cb = handlerObj.callback.bind({req: req, res: res});
  InfiniteTimeline.clean(req, dynamoDb, cb);
});

app.get('/quizzes', function (req, res) {
  Quizzes.index(req, res, dynamoDb);
});

app.get('/quizzes/new', function (req, res) {
  Quizzes.new(req, res, dynamoDb);
});

app.get('/quizzes/:quizId', function (req, res) {
  Quizzes.show(req, res, dynamoDb);
});

app.get('/quizzes/:quizId/edit', function (req, res) {
  Quizzes.edit(req, res, dynamoDb);
});

app.get('/quizzes/:quizId/delete', function (req, res) {
  Quizzes.destroy(req, res, dynamoDb);
});

app.post('/quizzes', upload.single('thumbnail'), function (req, res) {
  if (req.body._method == 'POST') {
    Quizzes.create(req, res, dynamoDb);
  } else if (req.body._method == 'PUT') {
    Quizzes.update(req, res, dynamoDb);
  }
});

app.post('/quizzes/:quizId', function (req, res) {
  Quizzes.grade(req, res, dynamoDb);
});

app.get('/insta_shorts', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  InstaShorts.index(req, dynamoDb, cb);
});

app.get('/insta_shorts/new', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  InstaShorts.new_short(req, dynamoDb, cb);
});

app.get('/insta_shorts/:instaId/edit', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  InstaShorts.edit(req, dynamoDb, cb);
});

app.get('/insta_shorts/:instaId/delete', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  InstaShorts.destroy(req, dynamoDb, cb);
});

app.post('/insta_shorts', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  if (req.body._method == 'POST') {
    InstaShorts.create(req, dynamoDb, cb);
  } else if (req.body._method == 'PUT') {
    InstaShorts.update(req, dynamoDb, cb);
  }
});

app.get('/crosswords', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Crosswords.index(req, dynamoDb, cb);
});

app.post('/crosswords', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  if (req.body._method == 'POST') {
    Crosswords.create(req, dynamoDb, cb);
  } else if (req.body._method == 'PUT') {
    Crosswords.update(req, dynamoDb, cb);
  }
});

app.get('/crosswords/new', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Crosswords.new_cross(req, dynamoDb, cb);
});

app.get('/crosswords/:crossId', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Crosswords.show(req, dynamoDb, cb);
});

app.get('/crosswords/:crossId/edit', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Crosswords.edit(req, dynamoDb, cb);
});

app.get('/crosswords/:crossId/delete', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Crosswords.destroy(req, dynamoDb, cb);
});

app.get('/videos', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Videos.index(req, dynamoDb, cb);
});

app.post('/videos', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  if (req.body._method == 'POST') {
    Videos.create(req, dynamoDb, cb);
  } else if (req.body._method == 'PUT') {
    Videos.update(req, dynamoDb, cb);
  }
});

app.get('/videos/new', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Videos.new_video(req, dynamoDb, cb);
});

app.get('/videos/:videoId', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Videos.show(req, dynamoDb, cb);
});

app.get('/videos/:videoId/edit', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Videos.edit(req, dynamoDb, cb);
});

app.get('/videos/:videoId/delete', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Videos.destroy(req, dynamoDb, cb);
});

/* WIP Issues
app.get('/issues', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Issues.index(req, dynamoDb, cb);
});

app.post('/issues', upload.single('link'), function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  if (req.body._method === 'POST') {
    Issues.create(req, dynamoDb, cb);
  } else if (req.body._method === 'PUT') {
    Issues.update(req, dynamoDb, cb);
  }
});

app.get('/issues/new', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Issues.new_issue(req, dynamoDb, cb);
});

app.get('/issues/:issueId', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Issues.show(req, dynamoDb, cb);
});

app.get('/issues/:issueId/edit', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Issues.edit(req, dynamoDb, cb);
});

app.get('/issues/:issueId/edit', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  Issues.destroy(req, dynamoDb, cb);
});
*/

app.get('/sitemap.xml', function (req, res) {
  res.type('application/xml');
  let out = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">';
  dynamoDb.scan({TableName: process.env.POSTS_TABLE}, function (err, data) {
    if (err) {
      console.error(err);
      res.send(`<error>${err}</error>`);
    } else {
      dynamoDb.scan({TableName: process.env.QUIZZES_TABLE}, function (er, dat) {
        if (er) {
          console.error(er);
          res.send(`<error>${er}</error>`);
        } else {
          for (let i = 0; i < data.Count; i++) {
            let post = data.Items[i];
            if (!post.staging) {
              out += '<url>';
              out += `<loc>https://thefishwrapper.news/posts/${escape(post.postId)}</loc>`;
              if (post.thumbnail) {
                out += `<image:image><image:loc>${post.thumbnail}</image:loc></image:image>`;
              }
              out += '</url>';
            }
          }
          for (let i = 0; i < dat.Count; i++) {
            out += '<url>';
            let quiz = dat.Items[i];
            out += `<loc>https://thefishwrapper.news/quizzes/${escape(quiz.quizId)}</loc>`;
            if (quiz.thumbnail) {
              out += `<image:image><image:loc>${quiz.thumbnail}</image:loc></image:image>`;
            }
            out += '</url>';
          }
          out += '</urlset>';
          res.send(out);
        }
      });
    }
  });
});

app.get('/robots.txt', function (req, res) {
  res.type('text/plain');
  res.send('Sitemap: https://www.thefishwrapper.news/sitemap.xml');
});

app.get('/googled33b7223d079ee62.html', function (req, res) { // Google search console verification
  const re = /https:\/\/s3.amazonaws.com\//
  let bucket = process.env.S3_BUCKET.replace(re, ''); // Get basename of the bucket
  bucket = bucket.substring(0, bucket.length - 1); // Remove trailing '/'
  const params = {
    Bucket: bucket,
    Key: 'googled33b7223d079ee62.html'
  };
  s3.getObject(params, (err, data) => {
    if (err) {
      console.error(err);
      res.render('error', {bucket: process.env.S3_BUCKET, req: req, error: err});
    } else {
      res.send(data.Body);
    }
  });
});

app.get('*', function (req, res) {
  const cb = handlerObj.callback.bind({req: req, res: res});
  cb('render', 'missing');
});

module.exports.handler = serverless(app);
