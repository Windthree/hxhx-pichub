const API_URL = "/.netlify/functions/api";

const app = {
    passcode: localStorage.getItem('r2_passcode') || '',
    userRoot: '',    
    files: [],       
    currentPath: '', 
    selectedKeys: new Set(),

    init: () => {
        if (app.passcode) {
            app.login(true);
        } else {
            document.getElementById('login-interface').style.display = 'block';
        }
        
        // 监听压缩模式 UI
        const desc = document.getElementById('compress-desc');
        const pngPanel = document.getElementById('png-settings-panel');
        document.querySelectorAll('input[name="compressMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val === 'png') {
                    pngPanel?.classList.remove('d-none');
                    if(desc) desc.innerText = '🔍 PNG模式：保持背景透明，请下方调节尺寸。';
                } else {
                    pngPanel?.classList.add('d-none');
                }
                if(val === 'chat' && desc) desc.innerText = '✨ WebP模式：适合大多数图片，体积极小。';
                if(val === 'hd' && desc) desc.innerText = '📸 原图模式：不做任何处理。视频/GIF 必须选此项。';
            });
        });

        const slider = document.getElementById('png-width-slider');
        const display = document.getElementById('png-width-display');
        if(slider && display) {
            slider.addEventListener('input', (e) => display.innerText = e.target.value + ' px');
        }
    },

    login: async (isAuto = false) => {
        const input = isAuto ? app.passcode : document.getElementById('passcode-input').value.trim();
        if (!input) return alert('请输入口令');
        
        app.passcode = input;
        const btn = document.querySelector('#login-interface button');
        if(!isAuto && btn) { btn.innerText = "验证中..."; btn.disabled = true; }

        try {
            await app.loadGallery(); 
            localStorage.setItem('r2_passcode', input);
            document.getElementById('login-interface').style.display = 'none';
            document.getElementById('app-interface').style.display = 'block';
            document.getElementById('user-badge').innerText = input;
        } catch (e) {
            console.error(e);
            if(!isAuto) alert('口令错误或网络异常');
            app.passcode = '';
        } finally {
            if(!isAuto && btn) { btn.innerText = "进入系统"; btn.disabled = false; }
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

    loadGallery: async () => {
        const data = await app.request('list', 'POST');
        app.userRoot = data.userRoot; // 核心：获取准确根路径
        app.files = data.files.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
        
        document.getElementById('file-count').innerText = app.files.length;
        document.getElementById('storage-used').innerText = (data.totalSize / 1024 / 1024).toFixed(2) + ' MB';
        
        app.updateFolderList(); // 更新上传框的目录列表
        app.renderView(); 
    },

    // 【新增功能】扫描所有文件，提取存在的目录，填充到下拉框
    updateFolderList: () => {
        const select = document.getElementById('upload-folder-select');
        if(!select) return;

        // 保留当前选中的值（如果有）
        const currentVal = select.value;
        
        // 清空列表，只留根目录
        select.innerHTML = '<option value="">(根目录)</option>';
        
        const knownPaths = new Set();
        
        app.files.forEach(file => {
            if (!file.key.startsWith(app.userRoot)) return;
            // 提取相对路径 "travel/2023/img.jpg"
            const rel = file.key.substring(app.userRoot.length);
            // 提取目录部分 "travel/2023/"
            const lastSlash = rel.lastIndexOf('/');
            if (lastSlash > -1) {
                const dir = rel.substring(0, lastSlash + 1); // 包含结尾斜杠
                knownPaths.add(dir);
            }
        });

        // 排序并添加到下拉框
        Array.from(knownPaths).sort().forEach(dir => {
            const opt = document.createElement('option');
            opt.value = dir;
            opt.innerText = dir;
            select.appendChild(opt);
        });

        // 如果之前新建的目录还没文件（临时添加的），也要保留在选项里
        // 这里简单处理：如果当前在某目录，默认选中该目录
        if (app.currentPath && Array.from(select.options).some(o => o.value === app.currentPath)) {
            select.value = app.currentPath;
        } else if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
            select.value = currentVal;
        }
    },

    createNewFolder: () => {
        const name = prompt("请输入新文件夹名称 (例如 travel):");
        if(name && /^[a-zA-Z0-9_-]+$/.test(name)){
            // 用户输入 "travel"，我们存为 "travel/"
            // 如果已经在 "work/" 目录下建，就是 "work/travel/" 吗？
            // 为了简单，我们只支持在【当前选择的目录】下建子目录，或者直接在根目录建。
            // 这里为了最简化交互：直接在【根目录】下建（或者手动输入路径）。
            
            // 让我们做得智能点：基于当前选中的目录追加
            const select = document.getElementById('upload-folder-select');
            const parent = select.value; // "" 或 "abc/"
            const newDir = parent + name + '/';

            // 临时添加到下拉框并选中
            const opt = document.createElement('option');
            opt.value = newDir;
            opt.innerText = newDir + " (新)";
            select.appendChild(opt);
            select.value = newDir;

            alert(`已选中新目录 "${newDir}"。\n请上传一张图片以永久保存此目录。`);
        } else if (name) {
            alert("名称格式不正确");
        }
    },

    formatSize: (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    },

    enterFolder: (folderName) => {
        app.currentPath += folderName + '/';
        app.renderView();
    },

    goToRoot: () => {
        app.currentPath = '';
        app.renderView();
    },

   renderView: () => {
        const container = document.getElementById('gallery-container');
        container.innerHTML = '';
        app.selectedKeys.clear();
        app.updateActionButtons();
        app.renderBreadcrumb();

        const subFolders = new Set();
        const subFiles = [];
        const fullPrefix = app.userRoot + app.currentPath;

        app.files.forEach(file => {
            if (!file.key.startsWith(fullPrefix)) return;
            
            // 获取相对路径
            let relativePart = file.key.substring(fullPrefix.length);

            // 【核心修复代码】如果相对路径是以 / 开头（说明出现了双斜杠 //），去掉它
            // 这样 "test//a.jpg" 变成 "/a.jpg" -> 再变成 "a.jpg"
            while(relativePart.startsWith('/')) {
                relativePart = relativePart.substring(1);
            }

            const slashIndex = relativePart.indexOf('/');
            
            if (slashIndex > -1) {
                // 是子文件夹
                const folderName = relativePart.substring(0, slashIndex);
                if(folderName) subFolders.add(folderName); // 确保不是空名
            } else {
                // 是文件
                if (relativePart.length > 0) subFiles.push(file);
            }
        });

        // 渲染文件夹
        Array.from(subFolders).sort().forEach(folder => {
            const col = document.createElement('div');
            col.className = 'col-6 col-md-4 col-lg-3';
            col.innerHTML = `
                <div class="card gallery-card p-2 h-100" onclick="app.enterFolder('${folder}')">
                    <div class="gallery-item d-flex align-items-center justify-content-center bg-light border-0">
                        <i class="bi bi-folder-fill folder-icon text-warning" style="font-size: 4rem;"></i>
                    </div>
                    <div class="mt-2 text-center text-truncate fw-bold">${folder}</div>
                </div>
            `;
            container.appendChild(col);
        });

        // 渲染文件
        subFiles.forEach(file => {
    const isVideo = file.key.toLowerCase().match(/\.(mp4|mov|avi|webm)$/i);
    const isImage = file.key.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|svg|heic)$/i);
    const name = file.key.split('/').pop();
    const sizeStr = app.formatSize(file.size);
    
    const col = document.createElement('div');
    col.className = 'col-6 col-md-4 col-lg-3';
    
    let mediaContent;
    if (isVideo) {
        mediaContent = `<div class="bg-dark d-flex align-items-center justify-content-center h-100"><i class="bi bi-camera-video-fill text-white fs-1"></i></div><div class="video-badge">VIDEO</div>`;
    } else if (isImage) {
        mediaContent = `<img src="${file.url}" loading="lazy">`;
    } else {
        // 其他文件显示通用图标 (利用已引入的 bootstrap-icons)
        mediaContent = `<div class="bg-white border-bottom d-flex flex-column align-items-center justify-content-center h-100">
            <i class="bi bi-file-earmark-text text-secondary" style="font-size: 3rem;"></i>
            <span class="small text-muted mt-2 px-1 text-truncate w-100 text-center">未知格式</span>
        </div>`;
    }

            col.innerHTML = `
                <div class="card gallery-card p-2 h-100" onclick="app.toggleSelect(this, '${file.key}', '${file.url}')">
                    <div class="gallery-item position-relative">
                        ${mediaContent}
                        <div class="file-info w-100 px-2 py-1 d-flex justify-content-between">
                            <span class="text-truncate" style="max-width: 60%">${name}</span>
                            <span class="small">${sizeStr}</span>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(col);
        });

        if (subFolders.size === 0 && subFiles.length === 0) {
            container.innerHTML = `<div class="col-12 text-center text-muted py-5"><i class="bi bi-inbox fs-1 d-block mb-3"></i>当前目录为空</div>`;
        }
    },

    renderBreadcrumb: () => {
        const bc = document.getElementById('folder-breadcrumb');
        let html = `<li class="breadcrumb-item"><a href="#" onclick="app.goToRoot(); return false;" class="text-decoration-none">根目录</a></li>`;
        if (app.currentPath) {
            app.currentPath.split('/').filter(p => p).forEach(p => {
                html += `<li class="breadcrumb-item active">${p}</li>`;
            });
        }
        bc.innerHTML = html;
    },

    toggleSelect: (card, key, url) => {
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
        const btnCopy = document.getElementById('btn-copy');
        const btnDel = document.getElementById('btn-delete');
        if(btnCopy) {
            btnCopy.disabled = !hasSel;
            btnCopy.innerText = hasSel ? `复制链接 (${app.selectedKeys.size})` : '复制链接';
        }
        if(btnDel) btnDel.disabled = !hasSel;
    },

    startUpload: async () => {
        const files = document.getElementById('file-input').files;
        if (files.length === 0) return alert('请选择文件');

        const select = document.getElementById('upload-folder-select');
        const currentFolder = select.value; 

        const modeInput = document.querySelector('input[name="compressMode"]:checked');
        const mode = modeInput ? modeInput.value : 'chat';
        const slider = document.getElementById('png-width-slider');
        const pngMaxWidth = slider ? parseInt(slider.value) : 150;

        const progressContainer = document.getElementById('upload-progress-container');
        const progressBar = document.getElementById('upload-bar');
        const currentFileSpan = document.getElementById('current-upload-file');
        
        progressContainer.classList.remove('d-none');

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            currentFileSpan.innerText = `${file.name}`;
            progressBar.style.width = `${((i)/files.length)*100}%`;

            // 【解除 4.5MB 限制】现在直传了，只要你 Cloudflare 没限制，传 100MB 都行
            // 不过为了体验，我们还是建议视频不要太大，但这里代码不再拦截

            try {
                let processedFile = file;
let filename = file.name;
const isVideo = file.type.startsWith('video');
const isGif = file.type === 'image/gif';
const isImage = file.type.startsWith('image/'); // 新增：判断是否为常规图片

                // 压缩逻辑保持不变
                if (isImage && !isGif) {
    if (mode === 'chat') {
                        processedFile = await imageCompression(file, {
                            maxSizeMB: 1,
                            maxWidthOrHeight: 1200,
                            useWebWorker: true,
                            fileType: 'image/webp'
                        });
                        filename = filename.replace(/\.[^/.]+$/, "") + ".webp";
                    } else if (mode === 'png') {
                        processedFile = await imageCompression(file, {
                            maxWidthOrHeight: pngMaxWidth,
                            useWebWorker: true,
                            fileType: 'image/png',
                            initialQuality: 0.9
                        });
                        filename = filename.replace(/\.[^/.]+$/, "") + ".png";
                    }
                }

                // 【核心改动：两步走上传】
                
                // 1. 找 Netlify 要“通行证” (URL)
                // 这里只传元数据，不传文件内容，极快，不耗流量
                const signData = await app.request('get_upload_url', 'POST', {
                    filename: filename,
                    folder: currentFolder,
                    contentType: processedFile.type // 关键：告诉后端我要传什么类型
                });

                // 2. 浏览器拿着通行证，直接把文件扔给 Cloudflare R2
                // 这一步完全绕过 Netlify
                await fetch(signData.uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': processedFile.type 
                    },
                    body: processedFile
                });

            } catch (e) {
                console.error(e);
                alert(`上传 ${file.name} 失败: ${e.message}`);
            }
        }

        progressBar.style.width = '100%';
        setTimeout(() => {
            const modalEl = document.getElementById('uploadModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if(modal) modal.hide();
            progressContainer.classList.add('d-none');
            app.loadGallery(); 
        }, 800);
    },

    fileToBase64: (file) => new Promise((r, j) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => r(reader.result.split(',')[1]);
        reader.onerror = j;
    }),

    deleteSelected: async () => {
        if(!confirm(`确定删除这 ${app.selectedKeys.size} 个项目吗？`)) return;
        try {
            await app.request('delete', 'POST', { keys: Array.from(app.selectedKeys) });
            app.loadGallery();
        } catch (e) { alert('删除失败'); }
    },
    
    copySelectedLinks: () => {
        const urls = [];
        document.querySelectorAll('.selected-card').forEach(el => urls.push(el.dataset.url));
        if(urls.length > 0) {
            navigator.clipboard.writeText(urls.join('\n')).then(() => alert('链接已复制'));
        }
    }
};

window.onload = app.init;
