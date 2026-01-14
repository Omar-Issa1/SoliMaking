# SoliMaking API – Endpoints Overview

Base URL: /api/v1  
Authentication: Bearer Token (JWT)

---

## Authentication
POST   /auth/register        - Register a new user  
POST   /auth/login           - User login (returns access token)

---

## Movies
GET    /movies               - Get all movies (pagination supported)  
GET    /movies/:id           - Get movie details by ID  
POST   /movies               - Add a new movie (Vimeo URL supported)  
PATCH  /movies/:id           - Update movie metadata  
DELETE /movies/:id           - Delete a movie by ID  

---

## Categories
POST   /categories           - Create a new category  

---

## Recommendations
GET    /recommend/me         - Get personalized movie recommendations  

---

## Security & Error Handling
• JWT-based authentication for protected routes  
• Role-based access control  
• Standardized JSON error responses with proper HTTP status codes  
