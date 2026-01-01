const API_URL = "/.netlify/functions/api";

const app = {
    passcode: localStorage.getItem('r2_passcode') || '',
    files: [],
    selectedKeys: new Set(),
    folders: new Set(),

    init: () => {
        if (app.passcode) {
            app.showApp();
        }
        
        // 监听压缩模式切换，更新提示
        document.querySelectorAll('input[name="compressMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const desc = document.getElementById('compress-desc');
                if(e.target.value === 'chat') desc.innerText = '✨ 转换为WebP，最大宽1200px，压缩率0.75';
                if(e.target.value === 'icon') desc.innerText = '🔍 强制PNG，缩放至150px宽，保留透明';
                if(e.target.value === 'hd') desc.innerText = '📸 保持原格式和尺寸 (注意：文件需<6MB)';
            });
        });
    },

   login: async () => {
        const input = document.getElementById('passcode-input').value.trim();
        if (!input) return alert('请输入口令');
        
        // 1. 先临时保存口令到内存，用于测试请求
        app.passcode = input;

        // 添加一个加载中的提示（可选）
        const btn = document.querySelector('#login-interface button');
        const originalText = btn.innerText;
        btn.innerText = "正在验证...";
        btn.disabled = true;

        try {
            // 2. 尝试向后台发起一个请求 (获取列表)
            // 如果口令不对，后台 api.js 会直接返回 403 错误，触发这里的 catch
            await app.request('list', 'POST');

            // 3. 如果没报错，说明口令正确，正式保存并进入
            localStorage.setItem('r2_passcode', input);
            app.showApp();
        } catch (e) {
            // 4. 验证失败
            console.error(e); // 方便调试
            alert('口令错误，请检查是否输入正确（区分大小写）');
            app.passcode = ''; // 清空错误口令
        } finally {
            // 恢复按钮状态
            btn.innerText = originalText;
            btn.disabled = false;
        }
    },

    logout: () => {
        localStorage.removeItem('r2_passcode');
        location.reload();
    },

    showApp: () => {
        document.getElementById('login-interface').style.display = 'none';
        document.getElementById('app-interface').style.display = 'block';
        document.getElementById('user-badge').innerText = 'User: ' + app.passcode;
        app.loadGallery();
    },

    // 核心 API 请求封装
    request: async (action, method = 'GET', body = null) => {
        const headers = { 'x-passcode': app.passcode };
        let url = `${API_URL}?action=${action}`;
        
        const options = { method, headers };
        if (body) {
            options.body = JSON.stringify(body);
        }

        const res = await fetch(url, options);
        if (res.status === 403) {
            alert('口令错误或无权访问');
            app.logout();
            throw new Error('Auth failed');
        }
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },

    // 加载图片列表
    loadGallery: async () => {
        try {
            const data = await app.request('list', 'POST'); // 使用POST避免URL过长，虽然语义一般是GET
            app.files = data.files.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
            
            // 更新统计
            document.getElementById('file-count').innerText = app.files.length;
            document.getElementById('storage-used').innerText = (data.totalSize / 1024 / 1024).toFixed(2) + ' MB';

            // 更新文件夹选项
            app.folders = new Set(data.folders);
            app.updateFolderSelects();
            
            app.renderGallery();
        } catch (e) {
            console.error(e);
        }
    },

    updateFolderSelects: () => {
        const renderOpts = (id, includeAll) => {
            const sel = document.getElementById(id);
            sel.innerHTML = includeAll ? '<option value="all">所有文件夹</option>' : '<option value="">根目录</option>';
            app.folders.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.innerText = f;
                sel.appendChild(opt);
            });
        };
        renderOpts('filter-folder', true);
        renderOpts('upload-folder-select', false);
    },

    createNewFolder: () => {
        const name = prompt("请输入新文件夹名称 (仅字母数字):");
        if(name && /^[a-zA-Z0-9_-]+$/.test(name)){
            const opt = document.createElement('option');
            opt.value = name;
            opt.innerText = name;
            opt.selected = true;
            document.getElementById('upload-folder-select').appendChild(opt);
            alert(`已临时选中文件夹 "${name}"，上传图片后生效`);
        } else if (name) {
            alert("文件夹名称格式不正确");
        }
    },

    filterGallery: () => {
        app.renderGallery();
    },

    renderGallery: () => {
        const container = document.getElementById('gallery-container');
        const folderFilter = document.getElementById('filter-folder').value;
        container.innerHTML = '';
        app.selectedKeys.clear();
        app.updateActionButtons();

        app.files.forEach(file => {
            // 过滤逻辑
            const isRoot = !file.key.includes('/'); // 简单判断，实际应结合passcode root logic，这里简化
            // 这里我们前端只拿到相对路径很难判断folder，因为key是完整的。
            // 简化：如果 key 包含 folderFilter 字符串
            if (folderFilter !== 'all' && !file.key.includes(`/${folderFilter}/`)) return;

            const col = document.createElement('div');
            col.className = 'col-6 col-md-3 col-lg-2';
            col.innerHTML = `
                <div class="card gallery-card p-2" onclick="app.toggleSelect(this, '${file.key}', '${file.url}')">
                    <img src="${file.url}" class="gallery-img" loading="lazy">
                    <div class="mt-2 text-truncate small text-muted">${file.key.split('/').pop()}</div>
                </div>
            `;
            container.appendChild(col);
        });
    },

    toggleSelect: (card, key, url) => {
        if (app.selectedKeys.has(key)) {
            app.selectedKeys.delete(key);
            card.classList.remove('selected-card');
        } else {
            app.selectedKeys.add(key);
            card.classList.add('selected-card');
            // 存个临时数据方便复制
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

    // 图片处理与上传
    startUpload: async () => {
        const files = document.getElementById('file-input').files;
        if (files.length === 0) return alert('请选择图片');

        const mode = document.querySelector('input[name="compressMode"]:checked').value;
        const folder = document.getElementById('upload-folder-select').value;
        
        const progressContainer = document.getElementById('upload-progress-container');
        const progressBar = document.getElementById('upload-bar');
        const currentFileSpan = document.getElementById('current-upload-file');
        
        progressContainer.classList.remove('d-none');

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            currentFileSpan.innerText = `${file.name} (${i+1}/${files.length})`;
            progressBar.style.width = `${((i)/files.length)*100}%`;

            try {
                // 1. 压缩处理
                let processedFile = file;
                let filename = file.name;

                if (mode === 'chat') {
                    processedFile = await imageCompression(file, {
                        maxSizeMB: 1,
                        maxWidthOrHeight: 1200,
                        useWebWorker: true,
                        fileType: 'image/webp'
                    });
                    filename = filename.replace(/\.[^/.]+$/, "") + ".webp";
                } else if (mode === 'icon') {
                    // PNG 缩放需用 Canvas 手动处理 (这里简化，利用库限制尺寸，但库转PNG可能变大)
                    // browser-image-compression 支持 fileType
                    processedFile = await imageCompression(file, {
                        maxWidthOrHeight: 150,
                        fileType: 'image/png',
                        initialQuality: 1 // 尽可能保留质量
                    });
                    // 此库对PNG透明度支持一般，若需完美透明可能需原生Canvas，此处暂用库
                } 
                // mode === 'hd' 不处理

                // 2. 转 Base64
                const base64Data = await app.fileToBase64(processedFile);

                // 3. 上传
                await app.request('upload', 'POST', {
                    filename: filename,
                    folder: folder,
                    fileData: base64Data, // 去掉 data:image/xxx;base64, 前缀
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
            app.loadGallery();
        }, 500);
    },

    fileToBase64: (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                // 移除 data:image/xyz;base64, 前缀
                const base64Content = reader.result.split(',')[1];
                resolve(base64Content);
            };
            reader.onerror = error => reject(error);
        });
    },

    deleteSelected: async () => {
        if(!confirm(`确定删除这 ${app.selectedKeys.size} 张图片吗？`)) return;
        
        try {
            await app.request('delete', 'POST', {
                keys: Array.from(app.selectedKeys)
            });
            app.loadGallery();
        } catch (e) {
            alert('删除失败');
        }
    },

    copySelectedLinks: () => {
        const urls = [];
        document.querySelectorAll('.selected-card').forEach(el => {
            urls.push(el.dataset.url);
        });
        navigator.clipboard.writeText(urls.join('\n')).then(() => {
            alert('链接已复制到剪贴板！');
        });
    }
};

window.onload = app.init;