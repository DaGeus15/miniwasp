# ZAP Scanning Report

ZAP by [Checkmarx](https://checkmarx.com/).


## Summary of Alerts

| Risk Level | Number of Alerts |
| --- | --- |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Informational | 4 |




## Insights

| Level | Reason | Site | Description | Statistic |
| --- | --- | --- | --- | --- |
| Low | Warning |  | ZAP warnings logged - see the zap.log file for details | 7    |
| Info | Informational | https://host.docker.internal:56441 | Percentage of responses with status code 1xx | 1 % |
| Info | Informational | https://host.docker.internal:56441 | Percentage of responses with status code 2xx | 96 % |
| Info | Informational | https://host.docker.internal:56441 | Percentage of responses with status code 4xx | 1 % |
| Info | Informational | https://host.docker.internal:56441 | Percentage of endpoints with content type application/json | 27 % |
| Info | Informational | https://host.docker.internal:56441 | Percentage of endpoints with content type image/svg+xml | 3 % |
| Info | Informational | https://host.docker.internal:56441 | Percentage of endpoints with content type text/css | 1 % |
| Info | Informational | https://host.docker.internal:56441 | Percentage of endpoints with content type text/html | 12 % |
| Info | Informational | https://host.docker.internal:56441 | Percentage of endpoints with content type text/javascript | 53 % |
| Info | Informational | https://host.docker.internal:56441 | Percentage of endpoints with method DELETE | 1 % |
| Info | Informational | https://host.docker.internal:56441 | Percentage of endpoints with method GET | 92 % |
| Info | Informational | https://host.docker.internal:56441 | Percentage of endpoints with method POST | 6 % |
| Info | Informational | https://host.docker.internal:56441 | Count of total endpoints | 83    |
| Info | Exceeded Low | https://host.docker.internal:56441 | Percentage of slow responses | 24 % |







## Alerts

| Name | Risk Level | Number of Instances |
| --- | --- | --- |
| Strict-Transport-Security Header Not Set | Low | 1 |
| Information Disclosure - Sensitive Information in URL | Informational | 4 |
| Information Disclosure - Suspicious Comments | Informational | 2 |
| Non-Storable Content | Informational | Systemic |
| Session Management Response Identified | Informational | 1 |




## Alert Detail



### [ Strict-Transport-Security Header Not Set ](https://www.zaproxy.org/docs/alerts/10035/)



##### Low (High)

### Description

HTTP Strict Transport Security (HSTS) is a web security policy mechanism whereby a web server declares that complying user agents (such as a web browser) are to interact with it using only secure HTTPS connections (i.e. HTTP layered over TLS/SSL). HSTS is an IETF standards track protocol and is specified in RFC 6797.

* URL: https://host.docker.internal:56441/
  * Node Name: `https://host.docker.internal:56441/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: ``


Instances: 1

### Solution

Ensure that your web server, application server, load balancer, etc. is configured to enforce Strict-Transport-Security.

### Reference


* [ https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html ](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html)
* [ https://owasp.org/www-community/Security_Headers ](https://owasp.org/www-community/Security_Headers)
* [ https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security ](https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security)
* [ https://caniuse.com/stricttransportsecurity ](https://caniuse.com/stricttransportsecurity)
* [ https://datatracker.ietf.org/doc/html/rfc6797 ](https://datatracker.ietf.org/doc/html/rfc6797)


#### CWE Id: [ 319 ](https://cwe.mitre.org/data/definitions/319.html)


#### WASC Id: 15

#### Source ID: 3

### [ Information Disclosure - Sensitive Information in URL ](https://www.zaproxy.org/docs/alerts/10024/)



##### Informational (Medium)

### Description

The request appeared to contain sensitive information leaked in the URL. This can violate PCI and most organizational compliance policies. You can configure the list of strings for this check to add or remove values specific to your environment.

* URL: https://host.docker.internal:56441/%3Finvite-token=ZAP
  * Node Name: `https://host.docker.internal:56441/ (invite-token)`
  * Method: `GET`
  * Parameter: `invite-token`
  * Attack: ``
  * Evidence: `invite-token`
  * Other Info: `The URL contains potentially sensitive information. The following string was found via the pattern: token
invite-token`
* URL: https://host.docker.internal:56441/%3Finvite-token=ZAP&name=ZAP&public-room-title=ZAP&text=ZAP
  * Node Name: `https://host.docker.internal:56441/ (invite-token,name,public-room-title,text)`
  * Method: `GET`
  * Parameter: `invite-token`
  * Attack: ``
  * Evidence: `invite-token`
  * Other Info: `The URL contains potentially sensitive information. The following string was found via the pattern: token
invite-token`
* URL: https://host.docker.internal:56441/%3Finvite-token=ZAP&name=ZAP&text=ZAP
  * Node Name: `https://host.docker.internal:56441/ (invite-token,name,text)`
  * Method: `GET`
  * Parameter: `invite-token`
  * Attack: ``
  * Evidence: `invite-token`
  * Other Info: `The URL contains potentially sensitive information. The following string was found via the pattern: token
invite-token`
* URL: https://host.docker.internal:56441/%3Finvite-token=ZAP&public-room-title=ZAP
  * Node Name: `https://host.docker.internal:56441/ (invite-token,public-room-title)`
  * Method: `GET`
  * Parameter: `invite-token`
  * Attack: ``
  * Evidence: `invite-token`
  * Other Info: `The URL contains potentially sensitive information. The following string was found via the pattern: token
invite-token`


Instances: 4

### Solution

Do not pass sensitive information in URIs.

### Reference



#### CWE Id: [ 598 ](https://cwe.mitre.org/data/definitions/598.html)


#### WASC Id: 13

#### Source ID: 3

### [ Information Disclosure - Suspicious Comments ](https://www.zaproxy.org/docs/alerts/10027/)



##### Informational (Medium)

### Description

The response appears to contain suspicious comments which may help an attacker.

* URL: https://host.docker.internal:56441/client/attachments/attachment-renderer.js
  * Node Name: `https://host.docker.internal:56441/client/attachments/attachment-renderer.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `unto de un mensaje. Todo se crea con createE`
  * Other Info: `The following pattern was used: \bTODO\b and was detected in likely comment: "// Dibuja el adjunto de un mensaje. Todo se crea con createElement y textContent: ningun dato", see evidence field for the suspicious comment/snippet.`
* URL: https://host.docker.internal:56441/client/chat/connection.js
  * Node Name: `https://host.docker.internal:56441/client/chat/connection.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `onexion que duplica todo.`
  * Other Info: `The following pattern was used: \bTODO\b and was detected in likely comment: "// anterior llega despues, y atenderlo abriria una segunda conexion que duplica todo.", see evidence field for the suspicious comment/snippet.`


Instances: 2

### Solution

Remove all comments that return information that may help an attacker and fix any underlying problems they refer to.

### Reference



#### CWE Id: [ 615 ](https://cwe.mitre.org/data/definitions/615.html)


#### WASC Id: 13

#### Source ID: 3

### [ Non-Storable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are not storable by caching components such as proxy servers. If the response does not contain sensitive, personal or user-specific information, it may benefit from being stored and cached, to improve performance.

* URL: https://host.docker.internal:56441/session
  * Node Name: `https://host.docker.internal:56441/session`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: https://host.docker.internal:56441/api/v1/videocalls/405a317b-6de2-4123-8b4c-5d6e7acd3efa/join
  * Node Name: `https://host.docker.internal:56441/api/v1/videocalls/405a317b-6de2-4123-8b4c-5d6e7acd3efa/join`
  * Method: `POST`
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

### [ Session Management Response Identified ](https://www.zaproxy.org/docs/alerts/10112/)



##### Informational (Medium)

### Description

The given response has been identified as containing a session management token. The 'Other Info' field contains a set of header tokens that can be used in the Header Based Session Management Method. If the request is in a context which has a Session Management Method set to "Auto-Detect" then this rule will change the session management to use the tokens identified.

* URL: https://host.docker.internal:56441/api/v1/auth/login
  * Node Name: `https://host.docker.internal:56441/api/v1/auth/login ()({name,acceptedRules})`
  * Method: `POST`
  * Parameter: `accessToken`
  * Attack: ``
  * Evidence: `accessToken`
  * Other Info: `json:accessToken`


Instances: 1

### Solution

This is an informational alert rather than a vulnerability and so there is nothing to fix.

### Reference


* [ https://www.zaproxy.org/docs/desktop/addons/authentication-helper/session-mgmt-id/ ](https://www.zaproxy.org/docs/desktop/addons/authentication-helper/session-mgmt-id/)



#### Source ID: 3


