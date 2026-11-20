# ZAP Scanning Report

ZAP by [Checkmarx](https://checkmarx.com/).


## Summary of Alerts

| Risk Level | Number of Alerts |
| --- | --- |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Informational | 2 |




## Insights

| Level | Reason | Site | Description | Statistic |
| --- | --- | --- | --- | --- |
| Info | Informational | https://miniwasp-production.up.railway.app | Percentage of responses with status code 2xx | 83 % |
| Info | Informational | https://miniwasp-production.up.railway.app | Percentage of responses with status code 4xx | 16 % |
| Info | Informational | https://miniwasp-production.up.railway.app | Percentage of endpoints with content type application/json | 20 % |
| Info | Informational | https://miniwasp-production.up.railway.app | Percentage of endpoints with content type image/svg+xml | 10 % |
| Info | Informational | https://miniwasp-production.up.railway.app | Percentage of endpoints with content type text/css | 10 % |
| Info | Informational | https://miniwasp-production.up.railway.app | Percentage of endpoints with content type text/html | 50 % |
| Info | Informational | https://miniwasp-production.up.railway.app | Percentage of endpoints with content type text/javascript | 10 % |
| Info | Informational | https://miniwasp-production.up.railway.app | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://miniwasp-production.up.railway.app | Count of total endpoints | 10    |
| Info | Informational | https://miniwasp-production.up.railway.app | Percentage of slow responses | 100 % |







## Alerts

| Name | Risk Level | Number of Instances |
| --- | --- | --- |
| Information Disclosure - Sensitive Information in URL | Informational | 2 |
| Non-Storable Content | Informational | Systemic |




## Alert Detail



### [ Information Disclosure - Sensitive Information in URL ](https://www.zaproxy.org/docs/alerts/10024/)



##### Informational (Medium)

### Description

The request appeared to contain sensitive information leaked in the URL. This can violate PCI and most organizational compliance policies. You can configure the list of strings for this check to add or remove values specific to your environment.

* URL: https://miniwasp-production.up.railway.app/%3Finvite-token=ZAP
  * Node Name: `https://miniwasp-production.up.railway.app/ (invite-token)`
  * Method: `GET`
  * Parameter: `invite-token`
  * Attack: ``
  * Evidence: `invite-token`
  * Other Info: `The URL contains potentially sensitive information. The following string was found via the pattern: token
invite-token`
* URL: https://miniwasp-production.up.railway.app/%3Finvite-token=ZAP&name=ZAP&text=ZAP
  * Node Name: `https://miniwasp-production.up.railway.app/ (invite-token,name,text)`
  * Method: `GET`
  * Parameter: `invite-token`
  * Attack: ``
  * Evidence: `invite-token`
  * Other Info: `The URL contains potentially sensitive information. The following string was found via the pattern: token
invite-token`


Instances: 2

### Solution

Do not pass sensitive information in URIs.

### Reference



#### CWE Id: [ 598 ](https://cwe.mitre.org/data/definitions/598.html)


#### WASC Id: 13

#### Source ID: 3

### [ Non-Storable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are not storable by caching components such as proxy servers. If the response does not contain sensitive, personal or user-specific information, it may benefit from being stored and cached, to improve performance.

* URL: https://miniwasp-production.up.railway.app
  * Node Name: `https://miniwasp-production.up.railway.app`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://miniwasp-production.up.railway.app/%3Finvite-token=ZAP
  * Node Name: `https://miniwasp-production.up.railway.app/ (invite-token)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://miniwasp-production.up.railway.app/client/styles/icon.svg
  * Node Name: `https://miniwasp-production.up.railway.app/client/styles/icon.svg`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://miniwasp-production.up.railway.app/robots.txt
  * Node Name: `https://miniwasp-production.up.railway.app/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://miniwasp-production.up.railway.app/sitemap.xml
  * Node Name: `https://miniwasp-production.up.railway.app/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``

Instances: Systemic


### Solution

The content may be marked as storable by ensuring that the following conditions are satisfied:
The request method must be understood by the cache and defined as being cacheable ("GET", "HEAD", and "POST" are currently defined as cacheable)
The response status code must be understood by the cache (one of the 1XX, 2XX, 3XX, 4XX, or 5XX response classes are generally understood)
The "no-store" cache directive must not appear in the request or response header fields
For caching by "shared" caches such as "proxy" caches, the "private" response directive must not appear in the response
For caching by "shared" caches such as "proxy" caches, the "Authorization" header field must not appear in the request, unless the response explicitly allows it (using one of the "must-revalidate", "public", or "s-maxage" Cache-Control response directives)
In addition to the conditions above, at least one of the following conditions must also be satisfied by the response:
It must contain an "Expires" header field
It must contain a "max-age" response directive
For "shared" caches such as "proxy" caches, it must contain a "s-maxage" response directive
It must contain a "Cache Control Extension" that allows it to be cached
It must have a status code that is defined as cacheable by default (200, 203, 204, 206, 300, 301, 404, 405, 410, 414, 501).

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html ](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)


#### CWE Id: [ 524 ](https://cwe.mitre.org/data/definitions/524.html)


#### WASC Id: 13

#### Source ID: 3


