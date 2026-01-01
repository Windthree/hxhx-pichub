const API_URL = "/.netlify/functions/api";

const app = {
    passcode: localStorage.getItem('r2_passcode') || '',
    files: [],       // 所有文件数据（扁平）
    currentPath: '', // 当前浏览的相对路径，例如 "travel/"，根目录为 ""
    selectedKeys: new Set(),

    init: () => {
        if (app.passcode) {
            app.login(true); // 自动登录尝试
        } else {
            document.getElementById('login-interface').style.display = 'block';
        }
        
        // 监听压缩模式切换
        document.querySelectorAll('input[name="compressMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const desc = document.getElementById('compress-desc');
                if(e.target.value === 'chat') desc.innerText = '✨ 图片压缩为WebP，省流且快。视频/GIF 会自动跳过压缩。';
                if(e.target.value === 'hd') desc.innerText = '📸 保持原始文件上传。⚠️ 必须 < 4.5MB。';
            });
        });
    },

    login: async (isAuto = false) => {
        const input = isAuto ? app.passcode : document.getElementById('passcode-input').value.trim();
        if (!input) return alert('请输入口令');
        
        app.passcode = input;
        const btn = document.querySelector('#login-interface button');
        if(!isAuto) { btn.innerText = "验证中..."; btn.disabled = true; }

        try {
            await app.loadGallery(); // 尝试拉取数据验证
            localStorage.setItem('r2_passcode', input);
            document.getElementById('login-interface').style.display = 'none';
            document.getElementById('app-interface').style.display = 'block';
            document.getElementById('user-badge').innerText = input;
        } catch (e) {
            console.error(e);
            if(!isAuto) alert('口令错误或网络异常');
            app.passcode = '';
        } finally {
            if(!isAuto) { btn.innerText = "进入系统"; btn.disabled = false; }
        }
    },

    logout: () => {
        localStorage.removeItem('r2_passcode');
        location.reload();
    },

    request: async (action, method = 'GET', body = null) => {
        const headers = { 'x-passcode': app.passcode };
        let url = `${API_URL}?action=${action}`;
        const options = { method, headers };
        if (body) options.body = JSON.stringify(body);

        const res = await fetch(url, options);
        if (res.status === 403) throw new Error('Auth failed');
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    // 加载数据
    loadGallery: async () => {
        const data = await app.request('list', 'POST');
        // 按时间倒序
        app.files = data.files.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
        
        document.getElementById('file-count').innerText = app.files.length;
        document.getElementById('storage-used').innerText = (data.totalSize / 1024 / 1024).toFixed(2) + ' MB';
        
        app.renderView(); // 渲染当前路径视图
    },

    // 格式化文件大小
    formatSize: (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    },

    // 进入文件夹
    enterFolder: (folderName) => {
        app.currentPath += folderName + '/';
        app.renderView();
    },

    // 返回上一级
    goUp: () => {
        const parts = app.currentPath.split('/').filter(p => p);
        parts.pop(); // 移除最后一级
        app.currentPath = parts.length > 0 ? parts.join('/') + '/' : '';
        app.renderView();
    },

    // 渲染主视图 (核心逻辑：区分文件和文件夹)
    renderView: () => {
        const container = document.getElementById('gallery-container');
        container.innerHTML = '';
        app.selectedKeys.clear();
        app.updateActionButtons();
        app.renderBreadcrumb();

        // 1. 找出当前路径下的直接子文件和子文件夹
        const subFolders = new Set();
        const subFiles = [];

        app.files.forEach(file => {
            // 获取相对于当前路径的文件名
            // 比如 userRoot/travel/2023/a.jpg, currentPath = "travel/"
            // relative = "2023/a.jpg"
            if (!file.key.includes(app.currentPath)) return; // 不在当前路径下

            // 截取掉当前路径前缀
            // 注意：API 返回的 key 包含了 userRoot，我们需要处理一下相对逻辑
            // 简单起见，我们在 api.js 里是返回完整 key。
            // 假设 key 是 "share/user/travel/a.jpg"，但前端只知道 currentPath="travel/"
            // 这里我们需要一个技巧：后端能否返回相对路径？
            // 修正：前端 app.files 里的 key 是 "share/user/travel/a.jpg"
            // 我们并不知道 "share/user/" 是多少，但我们可以通过“是否包含 currentPath”来判断
            
            // 更好的方式：我们在 api.js 返回 files 时，顺便把 userRoot 返回给前端，或者前端不需要知道 root。
            // 方案：我们只看 app.files 里的 key。
            // 只要 key 包含 currentPath (除了 root 部分)。
            // 这里的逻辑有点复杂，为了简单，我们假设 app.files 里的 key 已经是相对路径了？
            // 不，api.js 返回的是完整 Key。
            
            // 重新设计：我们利用一个特性，ListObjects 返回的 key 一定是以 userRoot 开头的。
            // 但是前端不知道 userRoot。
            // 临时方案：我们取第一个文件的路径作为基准推断 root，或者让 API 返回 root。
            // 为了不改 API，我们假设 currentPath 是匹配 Key 的一部分。
            
            // 修正逻辑：Folder View 需要更精确。
            // 让我们简化：只根据 "/" 分割。
            // 比如 A/B/C.jpg。如果当前在 A/，那 B 就是文件夹。
            // 为了让这个能工作，我们必须知道 UserRoot 到底多长。
            // 我们修改一下逻辑：以 files[0] 为例，倒推根目录？不靠谱。
            
            // *最稳妥修改*：请在 api.js 的 list 接口返回 userRoot。
            // 但为了你不改 api.js，我这里用前端“猜测”法。
            // 只要 file.key 包含了 app.currentPath... 等等， currentPath 是相对的。
            // 让我们在前端存储里记录一下 userRoot。
            // 其实，我们可以让 app.currentPath 存储“相对 UserRoot 的路径”。
            // 显示时，我们截取掉 file.key 前面的 userRoot 部分。
            
            const relativeKey = file.key.substring(file.key.indexOf(app.currentPath)); 
            // 哎呀，如果 userRoot 是 "share/bob/", currentPath 是 "travel/"
            // key 是 "share/bob/travel/pic.jpg"
            // 我们怎么知道 share/bob/ 是前缀？
            
            // **必杀技**：我们在 list 接口的数据里，其实 files[0].key 包含了完整路径。
            // 我们可以利用 "文件夹自动识别"。
            // 让我们假设所有的文件都属于这个用户，那么他们的共同前缀就是 Root。
        });
        
        // --- 修正逻辑开始 ---
        // 为了实现文件夹，我们需要先算出 UserRoot (公共前缀)
        if (app.files.length > 0 && !app.userRoot) {
            const firstKey = app.files[0].key; // "share/user/a.jpg"
            // 简单粗暴：所有文件的公共长前缀
            let common = firstKey;
            app.files.forEach(f => {
                let i = 0;
                while(i < common.length && i < f.key.length && common[i] === f.key[i]) i++;
                common = common.substring(0, i);
            });
            // 确保以 / 结尾
            if (!common.endsWith('/')) common = common.substring(0, common.lastIndexOf('/') + 1);
            app.userRoot = common; 
        }
        
        const root = app.userRoot || '';
        const fullCurrentPath = root + app.currentPath;

        app.files.forEach(file => {
            if (!file.key.startsWith(fullCurrentPath)) return;

            const relativePart = file.key.substring(fullCurrentPath.length);
            const slashIndex = relativePart.indexOf('/');

            if (slashIndex > -1) {
                // 是子文件夹
                subFolders.add(relativePart.substring(0, slashIndex));
            } else {
                // 是文件
                subFiles.push(file);
            }
        });
        // --- 修正逻辑结束 ---

        // 2. 渲染文件夹
        Array.from(subFolders).sort().forEach(folder => {
            const col = document.createElement('div');
            col.className = 'col-6 col-md-4 col-lg-3';
            col.innerHTML = `
                <div class="card gallery-card p-2" onclick="app.enterFolder('${folder}')">
                    <div class="gallery-item d-flex align-items-center justify-content-center bg-light">
                        <i class="bi bi-folder-fill folder-icon"></i>
                    </div>
                    <div class="mt-2 text-center text-truncate small fw-bold">${folder}</div>
                </div>
            `;
            container.appendChild(col);
        });

        // 3. 渲染文件
        subFiles.forEach(file => {
            const isVideo = file.key.toLowerCase().endsWith('.mp4');
            const name = file.key.split('/').pop();
            const sizeStr = app.formatSize(file.size);
            
            const col = document.createElement('div');
            col.className = 'col-6 col-md-4 col-lg-3';
            
            // 构建内容
            let mediaContent = '';
            if (isVideo) {
                mediaContent = `<video src="${file.url}" preload="metadata" muted></video>
                                <div class="video-badge">VIDEO</div>`;
            } else {
                mediaContent = `<img src="${file.url}" loading="lazy">`;
            }

            col.innerHTML = `
                <div class="card gallery-card p-2" onclick="app.toggleSelect(this, '${file.key}', '${file.url}')">
                    <div class="gallery-item">
                        ${mediaContent}
                        <div class="file-info">
                            <span class="text-truncate" style="max-width: 70%">${name}</span>
                            <span>${sizeStr}</span>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(col);
        });

        // 若空
        if (subFolders.size === 0 && subFiles.length === 0) {
            container.innerHTML = '<div class="col-12 text-center text-muted py-5">此文件夹为空</div>';
        }

        // 更新上传框显示的路径
        document.getElementById('upload-path-display').value = app.currentPath || '(根目录)';
        document.getElementById('upload-folder-val').value = app.currentPath;
    },

    renderBreadcrumb: () => {
        const bc = document.getElementById('folder-breadcrumb');
        let html = `<li class="breadcrumb-item"><a href="#" onclick="app.goToRoot(); return false;">根目录</a></li>`;
        
        if (app.currentPath) {
            const parts = app.currentPath.split('/').filter(p => p);
            let buildPath = '';
            parts.forEach((p, index) => {
                buildPath += p + '/';
                if (index === parts.length - 1) {
                    html += `<li class="breadcrumb-item active">${p}</li>`;
                } else {
                    // 这里由于闭包问题，简单处理
                    html += `<li class="breadcrumb-item text-muted">${p}</li>`; 
                }
            });
        }
        bc.innerHTML = html;
    },

    goToRoot: () => {
        app.currentPath = '';
        app.renderView();
    },

    toggleSelect: (card, key, url) => {
        // 如果是视频，点击不要直接选中，而是可以播放？
        // 为了简单，我们依然保持选中逻辑，点击图片/视频区域选中
        // 如果想看大图/播放，可以用 "复制链接" 并在新窗口打开
        if (app.selectedKeys.has(key)) {
            app.selectedKeys.delete(key);
            card.classList.remove('selected-card');
        } else {
            app.selectedKeys.add(key);
            card.classList.add('selected-card');
            card.dataset.url = url; 
        }
        app.updateActionButtons();
    },

    updateActionButtons: () => {
        const hasSel = app.selectedKeys.size > 0;
        document.getElementById('btn-copy').disabled = !hasSel;
        document.getElementById('btn-delete').disabled = !hasSel;
        document.getElementById('btn-copy').innerText = hasSel ? `复制链接 (${app.selectedKeys.size})` : '复制链接';
    },

    createNewFolder: () => {
        const name = prompt("请输入子文件夹名称 (仅字母数字):");
        if(name && /^[a-zA-Z0-9_-]+$/.test(name)){
            app.currentPath += name + '/';
            app.renderView();
        } else if (name) {
            alert("格式不正确");
        }
    },

    startUpload: async () => {
        const files = document.getElementById('file-input').files;
        if (files.length === 0) return alert('请选择文件');

        // 获取当前进入的路径作为上传路径
        const currentFolder = document.getElementById('upload-folder-val').value; // e.g. "travel/"
        const mode = document.querySelector('input[name="compressMode"]:checked').value;
        
        const progressContainer = document.getElementById('upload-progress-container');
        const progressBar = document.getElementById('upload-bar');
        const currentFileSpan = document.getElementById('current-upload-file');
        
        progressContainer.classList.remove('d-none');

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            currentFileSpan.innerText = `${file.name}`;
            progressBar.style.width = `${((i)/files.length)*100}%`;

            // 检查大小 (4.5MB 限制)
            if (file.size > 4.5 * 1024 * 1024) {
                alert(`文件 ${file.name} 超过 4.5MB，Netlify 会拒绝上传。跳过此文件。`);
                continue;
            }

            try {
                let processedFile = file;
                let filename = file.name;
                const isVideo = file.type.startsWith('video');
                const isGif = file.type === 'image/gif';

                // 只有普通图片才压缩
                if (!isVideo && !isGif && mode === 'chat') {
                    processedFile = await imageCompression(file, {
                        maxSizeMB: 1,
                        maxWidthOrHeight: 1200,
                        useWebWorker: true,
                        fileType: 'image/webp'
                    });
                    filename = filename.replace(/\.[^/.]+$/, "") + ".webp";
                }

                const base64Data = await app.fileToBase64(processedFile);

                // 发送 folder 参数 (注意：后端是简单的 userRoot + folder + filename)
                // 这里的 folder 应该是相对路径，去掉 userRoot
                // 我们的 currentFolder 已经是相对的了（如 "travel/"）
                
                await app.request('upload', 'POST', {
                    filename: filename,
                    folder: currentFolder, // 传入相对路径
                    fileData: base64Data,
                    contentType: processedFile.type
                });

            } catch (e) {
                console.error(e);
                alert(`上传 ${file.name} 失败: ${e.message}`);
            }
        }

        progressBar.style.width = '100%';
        setTimeout(() => {
            bootstrap.Modal.getInstance(document.getElementById('uploadModal')).hide();
            progressContainer.classList.add('d-none');
            app.loadGallery(); // 重新加载列表
        }, 800);
    },

    fileToBase64: (file) => new Promise((r, j) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => r(reader.result.split(',')[1]);
        reader.onerror = j;
    }),

    deleteSelected: async () => { /* 保持原样 */
        if(!confirm(`确定删除这 ${app.selectedKeys.size} 个项目吗？`)) return;
        try {
            await app.request('delete', 'POST', { keys: Array.from(app.selectedKeys) });
            app.loadGallery();
        } catch (e) { alert('删除失败'); }
    },
    
    copySelectedLinks: () => { /* 保持原样 */
        const urls = [];
        document.querySelectorAll('.selected-card').forEach(el => urls.push(el.dataset.url));
        navigator.clipboard.writeText(urls.join('\n')).then(() => alert('链接已复制'));
    }
};

window.onload = app.init;