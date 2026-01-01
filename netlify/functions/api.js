const { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const busboy = require("busboy");

// 1. 初始化 R2 客户端
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const DOMAIN = process.env.R2_PUBLIC_DOMAIN; // 例如 https://pub.yourdomain.com

// 2. 简易用户鉴权配置 (口令 -> 目录映射)
// 实际部署时，可以在 Netlify 环境变量中配置 USER_MAPPING，格式为 JSON 字符串
// 默认回退值仅供测试
const getUserRoot = (passcode) => {
  let mapping = {};
  try {
    mapping = JSON.parse(process.env.USER_MAPPING || '{}');
  } catch (e) {
    console.error("环境变量解析失败", e);
  }
  
  // 示例：如果口令是 "demo123"，目录是 "share/demo_user/"
  // 如果找不到映射，返回 null
  return mapping[passcode] || null;
};

exports.handler = async (event, context) => {
  // 仅允许 POST 请求
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // 获取 Passcode
  const headers = event.headers;
  const passcode = headers["x-passcode"];
  const userRoot = getUserRoot(passcode);

  if (!userRoot) {
    return { statusCode: 403, body: JSON.stringify({ error: "口令错误或无权限" }) };
  }

  try {
    // 解析请求动作
    // 由于 Netlify 处理 multipart/form-data 比较麻烦，
    // 我们这里让前端把动作放在 query 参数或者 header 里，或者根据 content-type 判断
    // 为了简单，我们统一解析 JSON body 或者 base64 图片（上传时）
    
    const action = event.queryStringParameters.action;

    // --- 功能 1: 获取文件列表 (List) ---
    if (action === "list") {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: userRoot // 强制限制在用户目录下
      });
      const data = await s3.send(command);
      
      // 计算总存储量
      const objects = data.Contents || [];
      const totalSize = objects.reduce((acc, obj) => acc + obj.Size, 0);
      
      // 格式化返回数据
      const files = objects.map(item => ({
        key: item.Key,
        url: `${DOMAIN}/${item.Key}`,
        size: item.Size,
        lastModified: item.LastModified
      }));

      // 提取所有子文件夹 (简单通过斜杠判断)
      const folders = new Set();
      files.forEach(f => {
        const relativePath = f.key.replace(userRoot, "");
        if (relativePath.includes("/")) {
          folders.add(relativePath.split("/")[0]);
        }
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ files, totalSize, folders: Array.from(folders) })
      };
    }

    // --- 功能 2: 上传文件 (Upload) ---
    if (action === "upload") {
      // 注意：Netlify Function Body 默认为 base64 (如果是二进制)
      // 前端我们会发送 JSON: { filename: "a.jpg", folder: "sub", fileData: "base64..." }
      const body = JSON.parse(event.body);
      const { filename, folder, fileData, isBase64 } = body;

      // 构建最终路径：用户根目录 + (可选子目录) + 文件名
      let targetKey = userRoot;
      if (folder) targetKey += `${folder}/`;
      targetKey += filename;

      // 转换数据
      const buffer = Buffer.from(fileData, 'base64');

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: targetKey,
        Body: buffer,
        ContentType: body.contentType || 'image/jpeg'
      }));

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, url: `${DOMAIN}/${targetKey}` })
      };
    }

    // --- 功能 3: 删除文件 (Delete) ---
    if (action === "delete") {
      const { keys } = JSON.parse(event.body); // keys 是相对路径或完整 Key 列表
      
      // 安全检查：确保所有要删除的 Key 都以 userRoot 开头
      const safeKeys = keys.filter(k => k.startsWith(userRoot)).map(k => ({ Key: k }));

      if (safeKeys.length > 0) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: BUCKET_NAME,
          Delete: { Objects: safeKeys }
        }));
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, count: safeKeys.length })
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
