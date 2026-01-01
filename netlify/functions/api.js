const { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const DOMAIN = process.env.R2_PUBLIC_DOMAIN;

const getUserRoot = (passcode) => {
  let mapping = {};
  try {
    mapping = JSON.parse(process.env.USER_MAPPING || '{}');
  } catch (e) {
    console.error("环境变量解析失败", e);
  }
  return mapping[passcode] || null;
};

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const headers = event.headers;
  const passcode = headers["x-passcode"];
  const userRoot = getUserRoot(passcode);

  if (!userRoot) {
    return { statusCode: 403, body: JSON.stringify({ error: "口令错误或无权限" }) };
  }

  try {
    const action = event.queryStringParameters.action;

    // --- 功能 1: 获取列表 (List) ---
    if (action === "list") {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: userRoot
      });
      const data = await s3.send(command);
      
      const objects = data.Contents || [];
      const totalSize = objects.reduce((acc, obj) => acc + obj.Size, 0);
      
      const files = objects.map(item => ({
        key: item.Key,
        url: `${DOMAIN}/${item.Key}`, // 这里直接返回 Cloudflare 的公开链接，不走 Netlify
        size: item.Size,
        lastModified: item.LastModified
      }));

      // 返回 userRoot 供前端使用
      return {
        statusCode: 200,
        body: JSON.stringify({ files, totalSize, userRoot })
      };
    }

    // --- 功能 2: 获取上传预签名链接 (Get Upload URL) ---
    // 【核心改动】后端只生成链接，不接文件
    if (action === "get_upload_url") {
      const body = JSON.parse(event.body);
      const { filename, folder, contentType } = body;
      
      // 处理路径
      let targetKey = userRoot;
      if (folder) {
           targetKey += folder.endsWith('/') ? folder : `${folder}/`;
      }
      targetKey += filename;

      // 生成一个有效期 60秒 的 PUT 链接
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: targetKey,
        ContentType: contentType, // 必须指定类型，否则浏览器直传会报错
      });
      
      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

      return {
        statusCode: 200,
        body: JSON.stringify({ 
            uploadUrl, 
            publicUrl: `${DOMAIN}/${targetKey}`,
            key: targetKey
        })
      };
    }

    // --- 功能 3: 删除文件 (Delete) ---
    if (action === "delete") {
      const { keys } = JSON.parse(event.body);
      const safeKeys = keys.filter(k => k.startsWith(userRoot)).map(k => ({ Key: k }));

      if (safeKeys.length > 0) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: BUCKET_NAME,
          Delete: { Objects: safeKeys }
        }));
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true })
      };
    }

    return { statusCode: 400, body: "Unknown Action" };

  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};