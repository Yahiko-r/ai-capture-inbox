#!/usr/bin/env python3
from PIL import Image, ImageDraw

# 创建多个尺寸的图标
sizes = [32, 128, 256, 512, 1024]

# 定义像素风格的 R 字母（使用网格）
# 1 = 填充, 0 = 透明
pixel_r = [
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
    [1, 0, 1, 0, 0],
    [1, 0, 0, 1, 0],
    [1, 0, 0, 0, 1],
]

# 颜色配置
bg_color = (45, 55, 72, 255)      # 深灰蓝背景
r_color = (96, 165, 250, 255)     # 亮蓝色 R
border_color = (59, 130, 246, 255) # 边框蓝色

for size in sizes:
    # 创建图像
    img = Image.new('RGBA', (size, size), bg_color)
    draw = ImageDraw.Draw(img)

    # 计算像素块大小
    grid_height = len(pixel_r)
    grid_width = len(pixel_r[0])

    # 留出边距
    margin = size * 0.15
    usable_size = size - 2 * margin

    pixel_size = min(usable_size / grid_width, usable_size / grid_height)

    # 计算起始位置（居中）
    total_width = pixel_size * grid_width
    total_height = pixel_size * grid_height
    start_x = (size - total_width) / 2
    start_y = (size - total_height) / 2

    # 绘制像素 R
    for row_idx, row in enumerate(pixel_r):
        for col_idx, pixel in enumerate(row):
            if pixel == 1:
                x = start_x + col_idx * pixel_size
                y = start_y + row_idx * pixel_size

                # 绘制带圆角的像素块
                padding = pixel_size * 0.1
                draw.rounded_rectangle(
                    [x + padding, y + padding,
                     x + pixel_size - padding, y + pixel_size - padding],
                    radius=pixel_size * 0.15,
                    fill=r_color,
                    outline=border_color,
                    width=max(1, int(pixel_size * 0.05))
                )

    # 保存图标
    output_path = f'src-tauri/icons/icon_{size}x{size}.png'
    img.save(output_path, 'PNG')
    print(f'✓ 生成 {output_path}')

# 生成主图标（用于配置）
main_icon = Image.open('src-tauri/icons/icon_512x512.png')
main_icon.save('src-tauri/icons/icon.png', 'PNG')
print('✓ 生成 src-tauri/icons/icon.png')

print('\n所有图标生成完成！')
