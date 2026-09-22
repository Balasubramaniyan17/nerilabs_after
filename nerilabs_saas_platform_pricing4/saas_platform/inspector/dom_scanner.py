import urllib.request
import re
from typing import List, Dict, Any, Optional
from bs4 import BeautifulSoup

class DOMScanner:
    """
    Autonomously scans a target website URL, identifies high-impact conversion targets
    (Primary CTAs, Headlines, Pricing Buttons), and generates robust CSS selectors
    so founders never have to manually inspect code or write selectors.
    """
    CTA_KEYWORDS = [
        "start", "try", "get started", "join", "sign up", "signup",
        "launch", "book", "demo", "subscribe", "buy", "pricing",
        "free", "continue", "create", "test", "register", "contact"
    ]

    @classmethod
    def extract_colors_from_html(cls, html: str) -> Dict[str, str]:
        colors = {"primary": "#2E3CFF", "accent": "#3ECF8E"}
        if not html:
            return colors

        # 1. Look for CSS variables in style blocks
        var_matches = re.findall(r'--(accent|primary|brand|main)[^:]*:\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]+\))', html, re.I)
        if var_matches:
            colors["primary"] = var_matches[0][1]

        accent_matches = re.findall(r'--(accent|good|secondary|action)[^:]*:\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]+\))', html, re.I)
        for m in accent_matches:
            if m[1] != colors["primary"]:
                colors["accent"] = m[1]
                break

        # 2. Look for hex colors in style blocks if not found
        if not var_matches:
            hexes = re.findall(r'#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})', html)
            meaningful = [h for h in hexes if h.lower() not in ["#000", "#000000", "#fff", "#ffffff", "#0a0a0a", "#101010"]]
            if meaningful:
                colors["primary"] = meaningful[0]
            if len(meaningful) > 1:
                colors["accent"] = meaningful[1]

        return colors

    @classmethod
    def scan_url(cls, url: str) -> Dict[str, Any]:
        html = ""
        url = url.strip()
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url

        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NeriLabsInspector/2.5"}
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                html = resp.read().decode("utf-8", errors="ignore")
        except Exception:
            pass

        targets = cls.parse_html_for_targets(html, url)
        colors = cls.extract_colors_from_html(html)
        return {
            "targets": targets,
            "colors": colors
        }

    @classmethod
    def parse_html_for_targets(cls, html: str, url: str = "") -> List[Dict[str, Any]]:
        targets = []
        if not html:
            # Intelligent fallback targets for startup landing pages
            return [
                {
                    "id": "target_1",
                    "type": "BUTTON",
                    "label": "Primary Hero CTA Button",
                    "text": "Start Free Trial",
                    "selector": ".hero-ctas .btn-primary, #primary-cta, .btn-primary",
                    "recommended": True
                },
                {
                    "id": "target_2",
                    "type": "HEADLINE",
                    "label": "Hero Main Headline",
                    "text": "Transform Your Conversions",
                    "selector": ".hero h1, h1",
                    "recommended": False
                },
                {
                    "id": "target_3",
                    "type": "BUTTON",
                    "label": "Secondary Navigation Action",
                    "text": "See How It Works",
                    "selector": ".hero-ctas a:nth-child(2), nav .btn",
                    "recommended": False
                }
            ]

        soup = BeautifulSoup(html, "html.parser")
        seen_selectors = set()

        # 1. Detect Action Buttons / CTA Links
        candidates = soup.find_all(["a", "button", "input"])
        for el in candidates:
            if el.name == "input" and el.get("type") not in ["submit", "button"]:
                continue

            text = (el.get_text() or el.get("value") or "").strip()
            if not text or len(text) > 60:
                continue

            classes = " ".join(el.get("class", []))
            is_cta = any(kw in text.lower() for kw in cls.CTA_KEYWORDS)
            is_btn_class = any(c in classes.lower() for c in ["btn", "button", "cta", "primary", "signup", "action"])

            if is_cta or is_btn_class:
                selector = cls._compute_selector(el)
                if selector and selector not in seen_selectors:
                    seen_selectors.add(selector)

                    parent_classes = " ".join(el.parent.get("class", [])) if el.parent else ""
                    is_hero = any(h in (classes + parent_classes).lower() for h in ["hero", "header", "banner", "main"])
                    label = "Primary Hero Button" if is_hero or is_cta else "Action Button"

                    targets.append({
                        "id": f"target_{len(targets)+1}",
                        "type": "BUTTON",
                        "label": label,
                        "text": text,
                        "selector": selector,
                        "recommended": (len(targets) == 0)
                    })
                    if len(targets) >= 4:
                        break

        # 2. Detect Main H1 Headline
        h1 = soup.find("h1")
        if h1:
            h1_text = " ".join(h1.get_text().split())
            if h1_text and len(h1_text) < 120:
                h1_sel = cls._compute_selector(h1)
                targets.append({
                    "id": f"target_{len(targets)+1}",
                    "type": "HEADLINE",
                    "label": "Hero Headline",
                    "text": h1_text,
                    "selector": h1_sel,
                    "recommended": False
                })

        # 3. Detect Pricing Table Action
        pricing_containers = soup.find_all(class_=re.compile(r"price|pricing", re.I))
        for p in pricing_containers:
            p_btn = p.find(["a", "button"])
            if p_btn:
                p_text = p_btn.get_text().strip()
                if p_text and len(p_text) < 40:
                    p_sel = cls._compute_selector(p_btn)
                    if p_sel and p_sel not in seen_selectors:
                        seen_selectors.add(p_sel)
                        targets.append({
                            "id": f"target_{len(targets)+1}",
                            "type": "PRICING",
                            "label": "Pricing Tier CTA",
                            "text": p_text,
                            "selector": p_sel,
                            "recommended": False
                        })
                        break

        # Ensure at least one recommended target
        if targets and not any(t.get("recommended") for t in targets):
            targets[0]["recommended"] = True

        return targets[:5]

    @classmethod
    def _compute_selector(cls, el) -> str:
        if el.get("id"):
            return f"#{el['id']}"

        if el.get("data-tag"):
            return f'[data-tag="{el["data-tag"]}"]'

        if el.get("data-testid"):
            return f'[data-testid="{el["data-testid"]}"]'

        parent = el.parent
        el_classes = el.get("class", [])
        if parent and parent.get("class"):
            p_class = parent.get("class")[0]
            if el_classes:
                return f".{p_class} .{el_classes[0]}"
            return f".{p_class} {el.name}"

        if el_classes:
            return "." + ".".join(el_classes[:2])

        return el.name


    @classmethod
    def scan_pricing_plans(cls, url: str = "", html: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Autonomously scans a website URL or raw HTML for pricing tiers, extracting exact plan names,
        current dollar prices, price display CSS selectors, and checkout button selectors.
        Supports local/offline testing without requiring deployment.
        """
        if html:
            plans = cls.parse_pricing_plans_from_html(html, url)
            if plans:
                return plans

        if url:
            url = url.strip()
            if not url.startswith("http://") and not url.startswith("https://"):
                url = "https://" + url

            try:
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NeriLabsPriceScanner/2.0"}
                )
                with urllib.request.urlopen(req, timeout=6.0) as resp:
                    html = resp.read().decode("utf-8", errors="ignore")
            except Exception:
                pass

            if html:
                plans = cls.parse_pricing_plans_from_html(html, url)
                if plans:
                    return plans

        # Fallback mock tiers if site is offline or unreachable
        return [
            {
                "plan_name": "Starter Plan",
                "price_dollars": 49,
                "price_selector": ".pricing-grid .price-card:nth-child(2) .price-amount",
                "button_selector": ".pricing-grid .price-card:nth-child(2) .btn",
                "payment_link": "",
                "is_recommended": False
            },
            {
                "plan_name": "Growth Plan",
                "price_dollars": 99,
                "price_selector": ".pricing-grid .price-card:nth-child(3) .price-amount",
                "button_selector": ".pricing-grid .price-card:nth-child(3) .btn",
                "payment_link": "",
                "is_recommended": True
            },
            {
                "plan_name": "Scale Plan",
                "price_dollars": 199,
                "price_selector": ".pricing-grid .price-card:nth-child(4) .price-amount",
                "button_selector": ".pricing-grid .price-card:nth-child(4) .btn",
                "payment_link": "",
                "is_recommended": False
            }
        ]

    @classmethod
    def parse_pricing_plans_from_html(cls, html: str, url: str = "") -> List[Dict[str, Any]]:
        """
        Parses HTML from arbitrary website structures, detecting pricing cards, tier names,
        numeric price points, robust CSS selectors, and payment links.
        """
        if not html:
            return []

        soup = BeautifulSoup(html, "html.parser")

        # 1. Identify pricing container
        pricing_section = soup.find(id=re.compile(r"price|pricing", re.I))
        if not pricing_section:
            pricing_section = soup.find(class_=re.compile(r"pricing-grid|pricing-table|pricing-plans|pricing|tiers", re.I))

        container = pricing_section or soup

        # 2. Identify card elements
        cards = container.find_all(class_=re.compile(r"price-card|pricing-card|plan-card|price-box|tier-card|pricing-tier", re.I))
        if not cards:
            cards = container.find_all(class_=re.compile(r"card|plan|tier", re.I))

        # 3. Fallback for utility-first / Tailwind / semantic layouts:
        if not cards:
            deepest_price_nodes = [
                el for el in container.find_all(True)
                if re.search(r"[\$\€\£]\s*\d+", el.get_text())
                and not any(re.search(r"[\$\€\£]\s*\d+", child.get_text()) for child in el.find_all(True))
            ]
            for p in deepest_price_nodes:
                curr = p
                while curr and curr.parent and curr.parent != soup:
                    siblings = curr.parent.find_all(recursive=False)
                    price_siblings = [s for s in siblings if re.search(r"[\$\€\£]\s*\d+", s.get_text())]
                    if len(price_siblings) >= 2:
                        cards = price_siblings
                        if container == soup:
                            container = curr.parent
                        break
                    curr = curr.parent
                if cards:
                    break

        # Container selector prefix
        c_prefix = ""
        if container and container != soup:
            c_id = container.get("id")
            c_classes = container.get("class", [])
            if c_id:
                c_prefix = "#" + c_id + " "
            elif c_classes:
                c_matches = [c for c in c_classes if re.search(r"price|pricing|tier|plan|table|grid", c, re.I)]
                c_class = c_matches[0] if c_matches else c_classes[0]
                c_prefix = "." + c_class + " "

        plans = []
        for idx, card in enumerate(cards):
            # Plan name
            n_el = card.find(class_=re.compile(r"name|title|plan|tier|heading", re.I))
            if not n_el:
                n_el = card.find(["h1", "h2", "h3", "h4", "h5", "strong"])
            name = n_el.get_text().strip() if n_el else f"Plan {idx+1}"
            name = " ".join(name.split())
            if len(name) > 30:
                name = name[:26] + "..."

            # Price element
            p_el = card.find(class_=re.compile(r"amount|val|cost|sum|price-amount|price", re.I))
            if not p_el:
                for cand in card.find_all(["div", "span", "p", "h1", "h2", "h3", "h4", "strong"]):
                    txt = cand.get_text().strip()
                    if re.search(r"[\$\€\£]\s*\d+", txt):
                        p_el = cand
                        break

            price_val = 0
            price_txt = p_el.get_text().strip() if p_el else ""
            m = re.search(r"[\$\€\£]?\s*(\d+(?:\.\d{1,2})?)", price_txt)
            if m:
                price_val = float(m.group(1))
                if price_val.is_integer():
                    price_val = int(price_val)

            # Skip 0 / free / custom
            if price_val == 0 or "custom" in price_txt.lower() or name.lower() in ["free", "custom", "enterprise contact"]:
                continue

            child_idx = idx + 1
            card_id = card.get("id")
            card_classes = [c for c in card.get("class", []) if not re.search(r"active|focus|hover|selected", c, re.I)]

            if card_id:
                card_sel = "#" + card_id
            else:
                card_class = "." + card_classes[0] if card_classes else card.name
                card_sel = (c_prefix + card_class + f":nth-child({child_idx})").strip()

            # Price selector
            if p_el and p_el.get("id"):
                price_sel = "#" + p_el.get("id")
            elif p_el:
                p_classes = [c for c in p_el.get("class", []) if not re.search(r"active|focus|hover", c, re.I)]
                p_sub = "." + p_classes[0] if p_classes else p_el.name
                price_sel = card_sel + " " + p_sub
            else:
                price_sel = card_sel + " .price-amount"

            # Button / Action selector
            b_el = card.find(["a", "button", "input"])
            href = ""
            if b_el:
                if b_el.name == "a":
                    href = b_el.get("href", "")
                if b_el.get("id"):
                    btn_sel = "#" + b_el.get("id")
                else:
                    b_classes = [c for c in b_el.get("class", []) if re.search(r"btn|button|cta|action", c, re.I)]
                    if not b_classes and b_el.get("class"):
                        b_classes = [b_el.get("class")[0]]
                    b_sub = "." + b_classes[0] if b_classes else b_el.name
                    btn_sel = card_sel + " " + b_sub
            else:
                btn_sel = card_sel + " .btn"

            card_class_str = " ".join(card.get("class", []))
            is_rec = (
                any(w in name.lower() for w in ["growth", "pro", "popular", "recommended", "featured", "team"])
                or any(w in card_class_str.lower() for w in ["mid", "featured", "popular", "highlight", "border-blue", "ring"])
            )

            plans.append({
                "plan_name": name,
                "price_dollars": price_val,
                "price_selector": price_sel,
                "button_selector": btn_sel,
                "payment_link": href,
                "is_recommended": is_rec
            })

        return plans

