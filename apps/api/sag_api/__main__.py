"""`python -m sag_api` = sidecar CLI（冻结产物与源码环境共用一个 argv 分发）。"""

import sys

from sag_api.sidecar import main

sys.exit(main())
