import re

# 与既往 rebrand 提交一致的替换规则，外加我方特有的三类调整
def rename(text):
    out = text
    out = out.replace('__orca_', '__manta_').replace('__ORCA_', '__MANTA_')
    out = re.sub(r'\bOrca\b', 'Manta', out)
    out = re.sub(r'\bORCA\b', 'MANTA', out)
    out = re.sub(r'\borca\b', 'manta', out)
    out = out.replace('orca', 'manta').replace('Orca', 'Manta').replace('ORCA', 'MANTA')
    return out

def rename_full(text):
    out = rename(text)
    # 发布仓库指向我们自己的 fork
    out = out.replace('stablyai/manta-adhoc', 'paidaxingyo666/manta-adhoc')
    out = out.replace('stablyai/manta-hourly', 'paidaxingyo666/manta-hourly')
    out = out.replace('stablyai/manta-daily', 'paidaxingyo666/manta-daily')
    out = out.replace('github.com/stablyai/manta/', 'github.com/paidaxingyo666/Manta/')
    out = re.sub(r"'stablyai/manta'", "'paidaxingyo666/Manta'", out)
    out = out.replace("toBe('stablyai/manta')", "toBe('paidaxingyo666/Manta')")
    # 上游写 "an Orca"，改名后成了错误的冠词
    out = re.sub(r'\ban Manta\b', 'a Manta', out)
    out = re.sub(r'\bAn Manta\b', 'A Manta', out)
    out = re.sub(r'\ban manta://', 'a manta://', out)
    return out
